#include "src/ui/tabs/UICommon.h"
#include "src/web/Bridge.h"
#include "src/web/LocalServer.h"
#include "src/midi/WinMidi.h"
#include "src/video/NetworkVideo.h"
#include "src/video/PluginHost.h"
#include "src/web/NetScript.h"
#include "src/web/WebShell.h"

#include <atomic>
#include <thread>
#include <functional>
#include <unordered_map>

#ifndef RICO_VERSION
#define RICO_VERSION "3.0.0"
#endif

void ProcessMidiMessage(const std::vector<unsigned char>& message, int deviceIndex);

namespace {

LocalServer g_server;
bool g_restart = false;
bool g_networkOpen = false;
int g_pendingNetwork = -1;
static bool g_audioStream = false;
int g_currentClient = -1;
unsigned long long g_lastLogSerial = 0;
std::chrono::steady_clock::time_point g_lastState, g_lastLive;
std::vector<std::string> g_midiIns, g_midiOuts;
std::chrono::steady_clock::time_point g_lastDeviceScan;

using Args = const json&;
using Handler = std::function<json(Args)>;

// DMX: any universe over Art-Net or sACN, and finding Art-Net nodes
// The lighting desk in the interface sends whole universes (512 channels)
// about 40 times a second. Art-Net goes to the target IP (or broadcast);
// sACN (E1.31) goes to its multicast group, so any sACN node can listen.

SOCKET g_sacnSocket = INVALID_SOCKET;
SOCKET g_pollSocket = INVALID_SOCKET;
uint8_t g_sacnSequence[64] = {};
struct ArtNode { std::string ip, shortName, longName; std::chrono::steady_clock::time_point seen; };
std::vector<ArtNode> g_artNodes;

void sendArtNetUniverse(int universe, const uint8_t* data, int len) {
    if (!g_artnetState.initialized && !InitArtNet()) return;
    uint8_t packet[530] = {};
    memcpy(packet, "Art-Net\0", 8);
    packet[9] = 0x50;                   // OpDmx
    packet[11] = 14;                    // protocol version
    packet[12] = (uint8_t)g_artnetState.sequence++;
    packet[14] = universe & 0xFF;
    packet[15] = (universe >> 8) & 0x7F;
    int n = len < 2 ? 2 : (len > 512 ? 512 : len + (len & 1));
    packet[16] = (uint8_t)(n >> 8);
    packet[17] = (uint8_t)(n & 0xFF);
    memcpy(packet + 18, data, len > 512 ? 512 : len);
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(6454);
    addr.sin_addr.s_addr = inet_addr(g_artnetState.targetIP);
    sendto(g_artnetSocket, (char*)packet, 18 + n, 0, (sockaddr*)&addr, sizeof(addr));
}

void sendSacnUniverse(int universe, const uint8_t* data, int len, int priority) {
    if (universe < 1 || universe > 63999) return;
    if (g_sacnSocket == INVALID_SOCKET) {
        WSADATA wsa;
        WSAStartup(MAKEWORD(2, 2), &wsa);
        g_sacnSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (g_sacnSocket == INVALID_SOCKET) return;
        int ttl = 8;
        setsockopt(g_sacnSocket, IPPROTO_IP, IP_MULTICAST_TTL, (char*)&ttl, sizeof(ttl));
    }
    static const uint8_t cid[16] = { 'R', 'I', 'C', 'O', '-', 'L', 'I', 'G', 'H', 'T', '-', 'D', 'E', 'S', 'K', '1' };
    uint8_t p[638] = {};
    auto be16 = [&](int at, int v) { p[at] = (uint8_t)(v >> 8); p[at + 1] = (uint8_t)v; };
    auto be32 = [&](int at, uint32_t v) { p[at] = v >> 24; p[at + 1] = v >> 16; p[at + 2] = v >> 8; p[at + 3] = (uint8_t)v; };
    // Root layer
    be16(0, 0x0010); be16(2, 0);
    memcpy(p + 4, "ASC-E1.17\0\0\0", 12);
    be16(16, 0x7000 | (638 - 16)); be32(18, 0x00000004);
    memcpy(p + 22, cid, 16);
    // Framing layer
    be16(38, 0x7000 | (638 - 38)); be32(40, 0x00000002);
    const char* name = "RICO lighting desk";
    memcpy(p + 44, name, strlen(name));
    p[108] = (uint8_t)(priority < 0 ? 100 : (priority > 200 ? 200 : priority));
    p[111] = g_sacnSequence[universe % 64]++;
    be16(113, universe);
    // DMP layer
    be16(115, 0x7000 | (638 - 115)); p[117] = 0x02; p[118] = 0xA1;
    be16(119, 0); be16(121, 1); be16(123, 513);
    p[125] = 0;                          // start code
    memcpy(p + 126, data, len > 512 ? 512 : len);
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(5568);
    addr.sin_addr.s_addr = htonl((239u << 24) | (255u << 16) | ((unsigned)(universe >> 8) << 8) | (unsigned)(universe & 0xFF));
    sendto(g_sacnSocket, (char*)p, 638, 0, (sockaddr*)&addr, sizeof(addr));
}

bool openPollSocket() {
    if (g_pollSocket != INVALID_SOCKET) return true;
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    g_pollSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (g_pollSocket == INVALID_SOCKET) return false;
    BOOL yes = TRUE;
    setsockopt(g_pollSocket, SOL_SOCKET, SO_REUSEADDR, (char*)&yes, sizeof(yes));
    setsockopt(g_pollSocket, SOL_SOCKET, SO_BROADCAST, (char*)&yes, sizeof(yes));
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(6454);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(g_pollSocket, (sockaddr*)&addr, sizeof(addr)) != 0) { closesocket(g_pollSocket); g_pollSocket = INVALID_SOCKET; return false; }
    u_long nb = 1;
    ioctlsocket(g_pollSocket, FIONBIO, &nb);
    return true;
}

void sendArtPoll() {
    if (!openPollSocket()) return;
    uint8_t p[14] = {};
    memcpy(p, "Art-Net\0", 8);
    p[8] = 0x00; p[9] = 0x20;            // OpPoll
    p[11] = 14;
    p[12] = 0x02;                        // send me replies when things change
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(6454);
    addr.sin_addr.s_addr = htonl(INADDR_BROADCAST);
    sendto(g_pollSocket, (char*)p, sizeof(p), 0, (sockaddr*)&addr, sizeof(addr));
}

void readArtReplies() {
    if (g_pollSocket == INVALID_SOCKET) return;
    uint8_t buf[600];
    for (int k = 0; k < 32; k++) {
        int n = recv(g_pollSocket, (char*)buf, sizeof(buf), 0);
        if (n <= 0) break;
        if (n < 108 || memcmp(buf, "Art-Net\0", 8) != 0 || buf[8] != 0x00 || buf[9] != 0x21) continue;   // OpPollReply
        char ip[32];
        snprintf(ip, sizeof(ip), "%d.%d.%d.%d", buf[10], buf[11], buf[12], buf[13]);
        std::string shortName((char*)buf + 26, strnlen((char*)buf + 26, 18));
        std::string longName((char*)buf + 44, strnlen((char*)buf + 44, 64));
        auto now = std::chrono::steady_clock::now();
        bool found = false;
        for (auto& node : g_artNodes) if (node.ip == ip) { node.shortName = shortName; node.longName = longName; node.seen = now; found = true; }
        if (!found) g_artNodes.push_back({ ip, shortName, longName, now });
    }
}

// helpers

std::string str(Args a, const char* key, const std::string& fallback = "") {
    auto it = a.find(key);
    return (it != a.end() && it->is_string()) ? it->get<std::string>() : fallback;
}
int num(Args a, const char* key, int fallback = 0) {
    auto it = a.find(key);
    return (it != a.end() && it->is_number()) ? it->get<int>() : fallback;
}
float real(Args a, const char* key, float fallback = 0.0f) {
    auto it = a.find(key);
    return (it != a.end() && it->is_number()) ? it->get<float>() : fallback;
}
bool flag(Args a, const char* key, bool fallback = false) {
    auto it = a.find(key);
    return (it != a.end() && it->is_boolean()) ? it->get<bool>() : fallback;
}
void copyTo(char* dst, size_t size, const std::string& src) {
    strncpy_s(dst, size, src.c_str(), _TRUNCATE);
}

json ok() { return json{ { "ok", true } }; }
json fail(const std::string& why);
json done(const std::string& err) { return err.empty() ? ok() : fail(err); }

static int b64value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

// Bytes from a script: "bytes": [1, 2, 3], "b64": "AQID" (LED frames) or "text": "hello".
std::vector<uint8_t> payload(Args a) {
    std::vector<uint8_t> out;
    auto b = a.find("b64");
    if (b != a.end() && b->is_string()) {
        const std::string& s = b->get_ref<const std::string&>();
        out.reserve(s.size() * 3 / 4);
        int val = 0, bits = -8;
        for (char c : s) {
            int d = b64value(c);
            if (d < 0) continue;
            val = ((val << 6) | d) & 0xFFFFFF;
            bits += 6;
            if (bits >= 0) { out.push_back((uint8_t)((val >> bits) & 0xFF)); bits -= 8; }
        }
        return out;
    }
    auto it = a.find("bytes");
    if (it != a.end() && it->is_array()) {
        for (const auto& b : *it) if (b.is_number()) out.push_back((uint8_t)b.get<int>());
        return out;
    }
    std::string t = str(a, "text");
    return std::vector<uint8_t>(t.begin(), t.end());
}
json fail(const std::string& why) { return json{ { "ok", false }, { "error", why } }; }

void scanMidiDevices() {
    g_midiIns = GetMidiInDeviceNames();
    g_midiOuts = GetMidiOutDeviceNames();
    g_lastDeviceScan = std::chrono::steady_clock::now();
}

const char* controlTypeName(int t) {
    switch (t) {
    case 0: return "note";
    case 1: return "cc";
    case 2: return "pitchbend";
    case 3: return "program";
    case 4: return "aftertouch";
    }
    return "other";
}

// state

const std::string& localIp() {
    static std::string ip = GetLocalIPAddress();
    return ip;
}

json midiState() {
    json ports = json::array();
    for (const auto& p : g_virtualPorts) ports.push_back(p.name);
    return {
        { "backend", (int)g_currentMidiBackend },
        { "backends", { g_midiBackendNames[0], g_midiBackendNames[1] } },
        { "inputs", g_midiIns },
        { "outputs", g_midiOuts },
        { "inIndex", g_config.midiInDevice },
        { "outIndex", g_config.midiOutDevice },
        { "inOpen", g_midiInConnected },
        { "outOpen", g_midiOutConnected },
        { "thru", g_config.midiThru },
        { "autoConnect", g_config.autoConnectMIDI },
        { "virtualPorts", ports },
        { "windowsMidi", { { "compiled", WinMidi_IsCompiled() }, { "ready", WinMidi_Ready() }, { "status", WinMidi_Status() } } },
    };
}

json oscState() {
    json dests = json::array();
    for (const auto& d : g_oscDestinations)
        dests.push_back({ { "name", d.name }, { "ip", d.ip }, { "port", d.port }, { "enabled", d.enabled } });
    json presets = json::array();
    for (const auto& kv : g_presets)
        presets.push_back({ { "index", kv.first }, { "name", kv.second.name }, { "address", kv.second.baseAddress },
                            { "port", kv.second.port }, { "about", kv.second.description },
                            { "setup", kv.second.setupInstructions } });
    return {
        { "ip", g_config.oscIP },
        { "port", g_config.oscSendPort },
        { "listenPort", g_config.oscListenPort },
        { "address", g_config.oscAddress },
        { "sendToOSC", g_config.sendToOSC },
        { "oscToMidi", g_config.sendToMIDI },
        { "listening", g_config.receiveFromOSC },
        { "preset", g_currentPresetIndex },
        { "presets", presets },
        { "destinations", dests },
        { "localIp", localIp() },
    };
}

json mappingState() {
    json list = json::array();
    for (const auto& kv : g_controlMappings) {
        const auto& m = kv.second;
        list.push_back({ { "key", kv.first }, { "type", controlTypeName(m.controlType) }, { "channel", m.channel },
                         { "number", m.controller }, { "name", m.displayName }, { "address", m.oscAddress },
                         { "min", m.minValue }, { "max", m.maxValue }, { "momentary", m.isMomentary } });
    }
    return list;
}

json videoState() {
    json transports = json::array();
    const auto& list = PluginHost_Transports();
    for (int i = 0; i < (int)list.size(); ++i) {
        const auto& t = list[i];
        bool available = NetVideo_TransportAvailable(i);
        transports.push_back({ { "id", t.id }, { "name", t.name }, { "builtIn", t.builtIn },
                               { "available", available }, { "status", t.api->status_text() },
                               { "about", t.description }, { "homepage", t.homepage } });
    }
    json problems = json::array();
    for (const auto& p : PluginHost_Problems())
        problems.push_back({ { "file", p.file }, { "reason", p.reason } });

    json spoutSenders = g_spoutSenderList;
    return {
        { "transports", transports },
        { "pluginProblems", problems },
        { "pluginFolder", PluginHost_Folder() },
        { "transport", g_netVideo.transport },
        { "sending", g_netVideo.sending },
        { "source", (int)g_netVideo.source },
        { "monitor", g_netVideo.monitor },
        { "name", g_netVideo.senderName },
        { "width", g_netVideo.width },
        { "height", g_netVideo.height },
        { "receiving", g_netVideo.receiving },
        { "receivingFrom", g_netVideo.sourceName },
        { "receivedWidth", g_netVideo.receivedWidth },
        { "receivedHeight", g_netVideo.receivedHeight },
        { "sources", NetVideo_Sources() },
        { "bridgeToSpout", g_netVideo.bridgeToSpout },
        { "bridgeName", g_netVideo.spoutBridgeName },
        { "error", g_netVideo.lastError },
        { "spout", {
            { "sending", g_spoutState.initialized },
            { "name", g_spoutState.senderName },
            { "senders", spoutSenders },
            { "receiving", g_spoutState.receiverInitialized },
            { "receivingFrom", g_spoutState.receiverName },
        } },
    };
}

json dmxState() {
    std::vector<int> channels(g_artnetState.dmxData, g_artnetState.dmxData + 512);
    return { { "running", g_artnetState.initialized }, { "ip", g_artnetState.targetIP },
             { "universe", g_artnetState.universe }, { "channels", channels } };
}

json mqttState() {
    json messages = json::array();
    {
        std::lock_guard<std::mutex> lock(g_mqttMutex);
        int n = 0;
        for (const auto& m : g_mqttLog) {          // newest first
            messages.push_back({ { "topic", m.topic }, { "payload", m.payload.substr(0, 200) } });
            if (++n >= 60) break;
        }
    }
    return { { "connected", g_mqttState.connected }, { "broker", g_mqttState.broker },
             { "status", g_mqttState.status }, { "messages", messages } };
}

json fullState() {
    return {
        { "t", "state" },
        { "midi", midiState() },
        { "osc", oscState() },
        { "mappings", mappingState() },
        { "video", videoState() },
        { "audio", { { "capturing", g_audioState.capturing }, { "device", g_audioState.currentDeviceName } } },
        { "dmx", dmxState() },
        { "mqtt", mqttState() },
        { "app", { { "version", RICO_VERSION }, { "dataFolder", Paths::DataDir() }, { "classic", g_config.classicUI },
                   { "network", g_networkOpen }, { "screens", g_server.ClientCount() }, { "port", g_server.Port() } } },
    };
}

json liveState() {
    json log = json::array();
    {
        std::lock_guard<std::mutex> lock(g_logMutex);
        for (const auto& m : g_messageLog) {
            if (m.serial <= g_lastLogSerial) continue;
            log.push_back({ { "n", m.serial }, { "time", m.timestamp }, { "type", m.type }, { "text", m.description },
                            { "address", m.oscAddress }, { "value", m.normalizedValue }, { "ch", m.channel },
                            { "d1", m.data1 }, { "d2", m.data2 } });
            g_lastLogSerial = m.serial;
        }
    }

    json notes = json::array();
    {
        std::lock_guard<std::mutex> lock(g_notesMutex);
        for (int n : g_activeNotes) notes.push_back(n);
    }

    json values = json::object();
    for (const auto& kv : g_controlMappings)
        values[kv.first] = kv.second.normalizedValue;

    json audio = nullptr;
    if (g_audioState.capturing && g_audioAnalyzer) {
        AudioBands b = g_audioAnalyzer->GetBands();
        audio = { { "low", b.low }, { "mid", b.mid }, { "high", b.high }, { "level", b.overall },
                  { "kick", b.kickOnset }, { "snare", b.snareOnset } };
    }

    json lfos = json::array();
    for (const auto& l : g_lfoChannels) lfos.push_back({ { "name", l.name }, { "value", l.value } });

    auto since = std::chrono::steady_clock::now() - g_lastMidiActivity;
    return {
        { "t", "live" },
        { "log", log },
        { "notes", notes },
        { "values", values },
        { "audio", audio },
        { "lfos", lfos },
        { "midiActive", std::chrono::duration_cast<std::chrono::milliseconds>(since).count() < 250 },
    };
}

// commands

std::unordered_map<std::string, Handler>& commands() {
    static std::unordered_map<std::string, Handler> c;
    if (!c.empty()) return c;

    // MIDI
    c["midi.scan"] = [](Args) { scanMidiDevices(); return ok(); };
    c["midi.openIn"] = [](Args a) {
        int i = num(a, "index", -1);
        if (!OpenMidiInput(i)) return fail("Could not open that MIDI input. Another app may be using it.");
        g_config.midiInDevice = i;
        return ok();
    };
    c["midi.openOut"] = [](Args a) {
        int i = num(a, "index", -1);
        if (!OpenMidiOutput(i)) return fail("Could not open that MIDI output. Another app may be using it.");
        g_config.midiOutDevice = i;
        return ok();
    };
    c["midi.close"] = [](Args) { CloseMidiPorts(); g_config.midiInDevice = g_config.midiOutDevice = -1; return ok(); };
    c["midi.backend"] = [](Args a) {
        SwitchMidiBackend((MidiBackend)num(a, "index", 0));
        scanMidiDevices();
        if ((int)g_currentMidiBackend != num(a, "index", 0)) return fail(WinMidi_Status());
        return ok();
    };
    c["midi.thru"] = [](Args a) { g_config.midiThru = flag(a, "on"); return ok(); };
    c["midi.autoConnect"] = [](Args a) { g_config.autoConnectMIDI = flag(a, "on"); return ok(); };
    c["midi.virtual.create"] = [](Args a) {
        std::string name = str(a, "name", "RICO Port");
        if (!CreateNamedVirtualPort(name.c_str())) return fail(WinMidi_Status());
        scanMidiDevices();
        return ok();
    };
    c["midi.virtual.remove"] = [](Args a) {
        std::string name = str(a, "name");
        for (int i = 0; i < (int)g_virtualPorts.size(); ++i)
            if (name == g_virtualPorts[i].name) DestroyVirtualPort(i);
        scanMidiDevices();
        return ok();
    };
    // MIDI clock out (24 pulses a beat) on its own thread, so the timing
    // does not depend on the interface.
    c["midi.clock"] = [](Args a) {
        static std::atomic<bool> running{ false };
        static std::atomic<double> bpm{ 120.0 };
        static std::thread worker;
        bpm = std::max(20.0, std::min(300.0, (double)real(a, "bpm", (float)bpm.load())));
        bool on = flag(a, "on", running.load());
        if (on && !running) {
            if (worker.joinable()) worker.join();
            running = true;
            if (flag(a, "start", true)) { std::vector<unsigned char> st{ 0xFA }; SendMidiMessage(st); WinMidi_SendToVirtualPorts(st); }
            worker = std::thread([] {
                auto next = std::chrono::steady_clock::now();
                std::vector<unsigned char> tick{ 0xF8 };
                while (running) {
                    SendMidiMessage(tick);
                    WinMidi_SendToVirtualPorts(tick);
                    next += std::chrono::nanoseconds((long long)(60.0e9 / (bpm.load() * 24.0)));
                    std::this_thread::sleep_until(next);
                }
            });
        } else if (!on && running) {
            running = false;
            if (worker.joinable()) worker.join();
            std::vector<unsigned char> sp{ 0xFC };
            SendMidiMessage(sp);
            WinMidi_SendToVirtualPorts(sp);
        }
        json r = ok();
        r["running"] = running.load();
        r["bpm"] = bpm.load();
        return r;
    };
    // All notes off on every channel.
    c["midi.panic"] = [](Args) {
        for (int ch = 0; ch < 16; ch++) {
            std::vector<unsigned char> a{ (unsigned char)(0xB0 + ch), 123, 0 }, b{ (unsigned char)(0xB0 + ch), 120, 0 };
            SendMidiMessage(a); SendMidiMessage(b);
            WinMidi_SendToVirtualPorts(a); WinMidi_SendToVirtualPorts(b);
        }
        return ok();
    };
    c["midi.send"] = [](Args a) {
        auto it = a.find("bytes");
        if (it == a.end() || !it->is_array()) return fail("bytes missing");
        std::vector<unsigned char> bytes;
        for (const auto& b : *it) bytes.push_back((unsigned char)b.get<int>());
        SendMidiMessage(bytes);
        WinMidi_SendToVirtualPorts(bytes);
        return ok();
    };

    // OSC
    c["osc.target"] = [](Args a) {
        copyTo(g_config.oscIP, sizeof(g_config.oscIP), str(a, "ip", g_config.oscIP));
        g_config.oscSendPort = num(a, "port", g_config.oscSendPort);
        copyTo(g_config.oscAddress, sizeof(g_config.oscAddress), str(a, "address", g_config.oscAddress));
        InitializeOSC();
        return ok();
    };
    c["osc.preset"] = [](Args a) { LoadPreset(num(a, "index")); InitializeOSC(); return ok(); };
    c["osc.enabled"] = [](Args a) { g_config.sendToOSC = flag(a, "on"); return ok(); };
    c["osc.toMidi"] = [](Args a) { g_config.sendToMIDI = flag(a, "on"); return ok(); };
    c["osc.dest.add"] = [](Args a) {
        AddOSCDestination(str(a, "name", "Destination"), str(a, "ip", "127.0.0.1"), num(a, "port", 8000));
        return ok();
    };
    c["osc.dest.remove"] = [](Args a) { RemoveOSCDestination((size_t)num(a, "index", -1)); return ok(); };
    c["osc.dest.enable"] = [](Args a) {
        int i = num(a, "index", -1);
        if (i < 0 || i >= (int)g_oscDestinations.size()) return fail("No such destination");
        g_oscDestinations[i].enabled = flag(a, "on");
        return ok();
    };
    c["osc.send"] = [](Args a) {
        std::string address = str(a, "address");
        if (address.empty() || address[0] != '/') return fail("OSC addresses start with /");
        float value = real(a, "value");
        if (g_oscSender) {
            char buffer[1024];
            osc::OutboundPacketStream p(buffer, sizeof(buffer));
            p << osc::BeginMessage(address.c_str()) << value << osc::EndMessage;
            g_oscSender->Send(p.Data(), p.Size());
        }
        SendOSCToAllDestinations(address.c_str(), value);
        LogMessage("OSC out", "Sent " + address, address, value, -1);
        return ok();
    };

    // Mappings
    c["mapping.update"] = [](Args a) {
        auto it = g_controlMappings.find(str(a, "key"));
        if (it == g_controlMappings.end()) return fail("No such mapping");
        auto& m = it->second;
        m.oscAddress = str(a, "address", m.oscAddress);
        m.displayName = str(a, "name", m.displayName);
        m.minValue = real(a, "min", m.minValue);
        m.maxValue = real(a, "max", m.maxValue);
        return ok();
    };
    // A mapping made by hand, for people without a controller (or before it is plugged in).
    c["mapping.add"] = [](Args a) {
        int type = num(a, "type", 1);          // 0 note, 1 knob (CC), 2 pitch bend, 3 program, 4 pressure
        int channel = std::max(1, std::min(16, num(a, "channel", 1)));
        int number = std::max(0, std::min(127, num(a, "number", 0)));
        std::string key = std::to_string(type) + ":" + std::to_string(channel) + ":" + std::to_string(number);
        ControlMapping m;
        auto old = g_controlMappings.find(key);
        if (old != g_controlMappings.end()) m = old->second;
        m.controlType = type;
        m.channel = channel;
        m.controller = number;
        m.dataType = type == 0 ? "Note" : type == 1 ? "CC" : type == 2 ? "Pitch Bend" : type == 3 ? "Program" : "Aftertouch";
        m.isMomentary = type == 0;
        m.displayName = str(a, "name", m.displayName.empty() ? m.dataType + " Ch" + std::to_string(channel) + ":" + std::to_string(number) : m.displayName);
        std::string address = str(a, "address", m.oscAddress);
        if (address.empty() || address[0] != '/') {
            std::string base = g_config.oscAddress;
            if (base.empty() || base.back() != '/') base += "/";
            address = base + "ctrl" + std::to_string(g_controlMappings.size() + 1);
        }
        m.oscAddress = address;
        m.minValue = real(a, "min", m.minValue);
        m.maxValue = real(a, "max", m.maxValue);
        g_controlMappings[key] = m;
        json r = ok();
        r["key"] = key;
        return r;
    };
    // Moves a mapping as if its control moved: value 0 to 1.
    c["mapping.set"] = [](Args a) {
        auto it = g_controlMappings.find(str(a, "key"));
        if (it == g_controlMappings.end()) return fail("No such mapping");
        const ControlMapping& m = it->second;
        float v = std::max(0.0f, std::min(1.0f, real(a, "value")));
        int ch = (m.channel - 1) & 15;
        std::vector<unsigned char> bytes;
        switch (m.controlType) {
        case 0: bytes = { (unsigned char)((v > 0.5f ? 0x90 : 0x80) + ch), (unsigned char)m.controller, (unsigned char)(v > 0.5f ? 100 : 0) }; break;
        case 2: { int b = (int)(v * 16383); bytes = { (unsigned char)(0xE0 + ch), (unsigned char)(b & 127), (unsigned char)(b >> 7) }; break; }
        case 3: bytes = { (unsigned char)(0xC0 + ch), (unsigned char)m.controller }; break;
        case 4: bytes = { (unsigned char)(0xD0 + ch), (unsigned char)(v * 127) }; break;
        default: bytes = { (unsigned char)(0xB0 + ch), (unsigned char)m.controller, (unsigned char)(v * 127) }; break;
        }
        ProcessMidiMessage(bytes, -1);
        return ok();
    };
    c["mapping.remove"] = [](Args a) {
        if (g_learningMapping) g_learningMapping = nullptr;
        g_controlMappings.erase(str(a, "key"));
        return ok();
    };
    c["mapping.clear"] = [](Args) { g_learningMapping = nullptr; g_controlMappings.clear(); return ok(); };

    // Network video
    c["video.transport"] = [](Args a) {
        int i = num(a, "index");
        if (!NetVideo_TransportAvailable(i)) return fail(PluginHost_Transports().size() > (size_t)i
            ? PluginHost_Transports()[i].api->status_text() : "No such transport");
        NetVideo_SelectTransport(i);
        return ok();
    };
    c["video.name"] = [](Args a) {
        copyTo(g_netVideo.senderName, sizeof(g_netVideo.senderName), str(a, "name", "RICO"));
        if (g_netVideo.sending) { NetVideo_StopSending(); NetVideo_StartSending(); }
        return ok();
    };
    c["video.source"] = [](Args a) {
        if (!NetVideo_SetSource((NetVideoSource)num(a, "source"), num(a, "monitor"))) return fail(g_netVideo.lastError);
        return ok();
    };
    c["video.start"] = [](Args) { return NetVideo_StartSending() ? ok() : fail(g_netVideo.lastError); };
    c["video.stop"] = [](Args) { NetVideo_StopSending(); return ok(); };
    c["video.scan"] = [](Args) { NetVideo_RefreshSources(); return ok(); };
    c["video.connect"] = [](Args a) {
        return NetVideo_Connect(str(a, "name").c_str()) ? ok() : fail(g_netVideo.lastError);
    };
    c["video.disconnect"] = [](Args) { NetVideo_Disconnect(); return ok(); };
    c["video.bridge"] = [](Args a) {
        g_netVideo.bridgeToSpout = flag(a, "on");
        copyTo(g_netVideo.spoutBridgeName, sizeof(g_netVideo.spoutBridgeName), str(a, "name", g_netVideo.spoutBridgeName));
        return ok();
    };
    c["video.rescanPlugins"] = [](Args) { NetVideo_Shutdown(); NetVideo_Init(); return ok(); };

    // Spout
    c["spout.scan"] = [](Args) { UpdateSpoutSenderList(); return ok(); };
    c["spout.connect"] = [](Args a) { ConnectSpoutReceiver(str(a, "name").c_str()); return ok(); };
    c["spout.disconnect"] = [](Args) { DisconnectSpoutReceiver(); return ok(); };
    c["spout.start"] = [](Args a) {
        copyTo(g_spoutState.senderName, sizeof(g_spoutState.senderName), str(a, "name", g_spoutState.senderName));
        g_spoutState.sendCanvas = true;     // in this interface Spout sends the Create canvas
        return SpoutSender_Start() ? ok() : fail("Spout could not start on this graphics card.");
    };
    c["spout.stop"] = [](Args) { SpoutSender_Stop(); return ok(); };

    // Audio
    c["audio.start"] = [](Args a) {
        int device = num(a, "device", 0);
        return StartAudioCaptureDevice(device) ? ok() : fail(device > 0 ? "Could not open that audio input." : "Could not listen to the system audio.");
    };
    c["audio.devices"] = [](Args) {
        EnumerateAudioDevices();
        json r = ok();
        r["devices"] = g_audioState.deviceNames;
        return r;
    };
    c["audio.stream"] = [](Args a) {
        g_audioStream = a.value("on", false);
        AudioPcm_Enable(g_audioStream);
        return ok();
    };
    c["audio.stop"] = [](Args) { StopAudioCapture(); return ok(); };

    // DMX
    c["dmx.start"] = [](Args a) {
        copyTo(g_artnetState.targetIP, sizeof(g_artnetState.targetIP), str(a, "ip", g_artnetState.targetIP));
        g_artnetState.universe = num(a, "universe", g_artnetState.universe);
        return InitArtNet() ? ok() : fail("Art-Net could not open a network socket.");
    };
    c["dmx.stop"] = [](Args) { CleanupArtNet(); return ok(); };
    c["dmx.set"] = [](Args a) {
        SetDMXChannel(num(a, "channel", 1), real(a, "value"));
        if (g_artnetState.initialized) SendArtNetDMX();
        return ok();
    };
    // A whole universe: { universe, data: [512 numbers 0..255], protocol: "artnet" | "sacn", priority }
    c["dmx.universe"] = [](Args a) {
        auto it = a.find("data");
        if (it == a.end() || !it->is_array()) return fail("data missing");
        uint8_t data[512] = {};
        int len = 0;
        for (const auto& v : *it) { if (len >= 512) break; int x = v.is_number() ? v.get<int>() : 0; data[len++] = (uint8_t)(x < 0 ? 0 : (x > 255 ? 255 : x)); }
        int universe = num(a, "universe", 0);
        std::string proto = str(a, "protocol", "artnet");
        if (proto == "sacn") sendSacnUniverse(universe, data, len, num(a, "priority", 100));
        else sendArtNetUniverse(universe, data, len);
        // The first universe also shows in the classic DMX tab.
        if (universe == g_artnetState.universe) memcpy(g_artnetState.dmxData, data, len);
        return ok();
    };
    c["dmx.target"] = [](Args a) {
        copyTo(g_artnetState.targetIP, sizeof(g_artnetState.targetIP), str(a, "ip", g_artnetState.targetIP));
        return ok();
    };
    c["dmx.poll"] = [](Args) {
        sendArtPoll();
        return g_pollSocket == INVALID_SOCKET ? fail("Port 6454 is in use by another Art-Net program, so RICO cannot listen for nodes. Sending still works.") : ok();
    };
    c["dmx.nodes"] = [](Args) {
        readArtReplies();
        json list = json::array();
        for (const auto& n : g_artNodes) list.push_back({ { "ip", n.ip }, { "name", n.shortName }, { "long", n.longName } });
        json r = ok();
        r["nodes"] = list;
        return r;
    };

    // MQTT
    c["mqtt.connect"] = [](Args a) {
        copyTo(g_mqttState.broker, sizeof(g_mqttState.broker), str(a, "broker", g_mqttState.broker));
        return MQTTConnect() ? ok() : fail(g_mqttState.status);
    };
    c["mqtt.disconnect"] = [](Args) { MQTTDisconnect(); return ok(); };
    c["mqtt.publish"] = [](Args a) {
        MQTTPublish(str(a, "topic", "rico/out").c_str(), str(a, "payload").c_str());
        return ok();
    };

    // Script panels: raw ports for protocols RICO does not know yet
    c["net.udp.open"] = [](Args a) { return done(NetScript_UdpOpen(str(a, "id", "udp"), num(a, "port", 9000))); };
    c["net.udp.send"] = [](Args a) { return done(NetScript_UdpSend(str(a, "host", "127.0.0.1"), num(a, "port", 9000), payload(a))); };
    c["net.tcp.connect"] = [](Args a) { return done(NetScript_TcpConnect(str(a, "id", "tcp"), str(a, "host", "127.0.0.1"), num(a, "port", 0))); };
    c["net.tcp.send"] = [](Args a) { return done(NetScript_TcpSend(str(a, "id", "tcp"), payload(a))); };
    c["net.serial.open"] = [](Args a) { return done(NetScript_SerialOpen(str(a, "id", "serial"), str(a, "port", "COM3"), num(a, "baud", 115200))); };
    c["net.serial.send"] = [](Args a) { return done(NetScript_SerialSend(str(a, "id", "serial"), payload(a))); };
    c["net.serial.list"] = [](Args) { json r = ok(); r["ports"] = NetScript_SerialPorts(); return r; };
    c["net.close"] = [](Args a) { NetScript_Close(str(a, "id")); return ok(); };
    c["net.http"] = [](Args a) {
        return done(NetScript_Http(str(a, "id", "http"), str(a, "method", "GET"), str(a, "url"), str(a, "headers"), payload(a), num(a, "timeout", 15000)));
    };
    c["net.osc"] = [](Args a) {
        std::vector<OscArg> args;
        auto it = a.find("args");
        if (it != a.end() && it->is_array()) {
            for (const auto& v : *it) {
                OscArg o;
                if (v.is_string()) { o.isString = true; o.text = v.get<std::string>(); }
                else if (v.is_number_integer()) { o.isInt = true; o.number = v.get<double>(); }
                else if (v.is_number()) o.number = v.get<double>();
                else if (v.is_boolean()) { o.isInt = true; o.number = v.get<bool>() ? 1 : 0; }
                else continue;
                args.push_back(o);
            }
        }
        std::string address = str(a, "address");
        std::string err = NetScript_OscSend(str(a, "host", "127.0.0.1"), num(a, "port", 8000), address, args);
        if (err.empty()) LogMessage("OSC out", "Sent " + address, address, args.empty() || args[0].isString ? 0.0f : (float)args[0].number, -1);
        return done(err);
    };

    // App
    c["app.save"] = [](Args) { SaveConfig(); return ok(); };
    c["app.classic"] = [](Args) {
        g_config.classicUI = true;
        SaveConfig();
        g_restart = true;
        return ok();
    };
    c["app.openDataFolder"] = [](Args) {
        ShellExecuteA(nullptr, "open", Paths::DataDir().c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        return ok();
    };
    // Let phones, tablets and other computers on the network open RICO.
    c["app.network"] = [](Args a) {
        bool on = flag(a, "on");
        g_config.shareOnNetwork = on;
        SaveConfig();
        g_pendingNetwork = on ? 1 : 0;      // the server restarts after this message is answered
        return ok();
    };
    // Live sharing between screens: whatever one screen publishes, the others get.
    c["sync.publish"] = [](Args a) {
        json m = { { "t", "sync" }, { "channel", str(a, "channel") }, { "data", a.contains("data") ? a["data"] : json() }, { "from", g_currentClient } };
        g_server.Broadcast(m.dump(), g_currentClient);
        return ok();
    };
    // The size of the whole interface (WebView2 zoom, so every position stays right).
    c["app.zoom"] = [](Args a) {
        auto it = a.find("zoom");
        if (it != a.end() && it->is_number()) WebShell_SetZoom(it->get<double>());
        return json{ { "ok", true }, { "zoom", WebShell_Zoom() } };
    };
    c["app.openUrl"] = [](Args a) {
        std::string url = str(a, "url");
        if (url.rfind("https://", 0) != 0) return fail("Only https links can be opened.");
        ShellExecuteA(nullptr, "open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        return ok();
    };
    return c;
}

void onText(int client, const std::string& text) {
    json msg = json::parse(text, nullptr, false);
    if (msg.is_discarded() || !msg.is_object()) return;
    if (msg.value("t", "") != "cmd") return;

    std::string op = msg.value("op", "");
    json args = msg.contains("args") ? msg["args"] : json::object();
    json result;
    g_currentClient = client;
    auto it = commands().find(op);
    if (it == commands().end()) {
        result = fail("Unknown command: " + op);
    } else {
        try {
            result = it->second(args);
        } catch (std::exception& e) {
            result = fail(e.what());
        }
    }
    result["t"] = "ack";
    result["id"] = msg.value("id", 0);
    result["op"] = op;
    g_server.Send(client, result.dump());
    g_lastState = {};     // push fresh state right away
}

// Binary messages from the Create workspace:
//   "RFRM" | uint32 width | uint32 height | RGBA pixels (top row first)
void onBinary(int, const uint8_t* data, size_t size) {
    if (size < 12 || memcmp(data, "RFRM", 4) != 0) return;
    uint32_t w, h;
    memcpy(&w, data + 4, 4);
    memcpy(&h, data + 8, 4);
    if (w == 0 || h == 0 || w > 8192 || h > 8192) return;
    if (size < 12 + (size_t)w * h * 4) return;
    NetVideo_SubmitCanvasFrame(data + 12, (int)w, (int)h);
}

void onConnect(int client) {
    json hello = { { "t", "hello" }, { "version", RICO_VERSION }, { "engine", "windows" } };
    g_server.Send(client, hello.dump());
    g_lastLogSerial = 0;
    g_server.Send(client, fullState().dump());
}

} // namespace

bool Bridge_Start(bool allowNetwork) {
    g_server.onText = onText;
    g_server.onBinary = onBinary;
    g_server.onConnect = onConnect;
    std::string root = Paths::ExeDir() + "ui";
    // Try the usual port first so bookmarks keep working, then any free one.
    g_networkOpen = allowNetwork;
    if (!g_server.Start(47900, root, allowNetwork) && !g_server.Start(0, root, allowNetwork)) {
        LogInfo("The interface server could not start.");
        return false;
    }
    scanMidiDevices();
    LogInfo("Interface ready at %s", Bridge_Url().c_str());
    return true;
}

void Bridge_Stop() { NetScript_CloseAll(); g_server.Stop(); }

int Bridge_Port() { return g_server.Port(); }

std::string Bridge_Url() { return "http://127.0.0.1:" + std::to_string(g_server.Port()) + "/"; }

bool Bridge_RestartRequested() { return g_restart; }

// Sends captured sound to the interface's audio lab as binary messages:
// "RPCM", sample rate (u32), channels (u16), 0 (u16), then 16-bit samples.
static void sendAudioStream() {
    static std::vector<int16_t> pcm;
    int rate = 48000;
    if (!AudioPcm_Take(pcm, rate)) return;
    std::vector<uint8_t> msg(12 + pcm.size() * 2);
    msg[0] = 'R'; msg[1] = 'P'; msg[2] = 'C'; msg[3] = 'M';
    uint32_t r = (uint32_t)rate;
    memcpy(&msg[4], &r, 4);
    uint16_t ch = 2, zero = 0;
    memcpy(&msg[8], &ch, 2);
    memcpy(&msg[10], &zero, 2);
    memcpy(&msg[12], pcm.data(), pcm.size() * 2);
    g_server.BroadcastBinary(msg.data(), msg.size());
    pcm.clear();
}

void Bridge_Tick() {
    g_server.Poll();
    if (g_pendingNetwork >= 0) {
        bool on = g_pendingNetwork == 1;
        g_pendingNetwork = -1;
        int port = g_server.Port();
        std::string root = Paths::ExeDir() + "ui";
        g_server.Stop();
        if (g_server.Start(port, root, on) || g_server.Start(0, root, on)) g_networkOpen = on;
        else LogInfo("The interface server could not restart.");
        return;
    }
    if (g_server.ClientCount() == 0) return;

    auto now = std::chrono::steady_clock::now();
    if (now - g_lastDeviceScan > std::chrono::seconds(3)) scanMidiDevices();
    if (now - g_lastState > std::chrono::milliseconds(250)) {
        g_server.Broadcast(fullState().dump());
        g_lastState = now;
    }
    if (g_audioStream) sendAudioStream();
    readArtReplies();
    NetScript_Poll([](const NetEvent& e) {
        json m = { { "t", "net" }, { "kind", e.kind }, { "id", e.id }, { "from", e.from }, { "bytes", e.data } };
        g_server.Broadcast(m.dump());
    });
    if (now - g_lastLive > std::chrono::milliseconds(33)) {
        g_server.Broadcast(liveState().dump());
        g_lastLive = now;
    }
}
