#include "src/midi/WinMidi.h"

#include <mutex>

void ProcessMidiMessage(const std::vector<unsigned char>& message, int deviceIndex);

#ifndef RICO_WITH_WINDOWS_MIDI

bool WinMidi_IsCompiled() { return false; }
bool WinMidi_Init() { return false; }
void WinMidi_Shutdown() {}
bool WinMidi_Ready() { return false; }
const char* WinMidi_Status() { return "This build of RICO was made without Windows MIDI Services."; }
std::vector<std::string> WinMidi_EndpointNames() { return {}; }
bool WinMidi_OpenInput(int) { return false; }
bool WinMidi_OpenOutput(int) { return false; }
void WinMidi_Send(const std::vector<unsigned char>&) {}
void WinMidi_CloseDevices() {}
bool WinMidi_CreateVirtualPort(const std::string&) { return false; }
void WinMidi_RemoveVirtualPort(const std::string&) {}
void WinMidi_RemoveAllVirtualPorts() {}
void WinMidi_SendToVirtualPorts(const std::vector<unsigned char>&) {}

#else

#include <windows.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Microsoft.Windows.Devices.Midi2.h>
#include <winrt/Microsoft.Windows.Devices.Midi2.Endpoints.Loopback.h>
#include <winmidi/init/Microsoft.Windows.Devices.Midi2.Initialization.hpp>

namespace midi2 = winrt::Microsoft::Windows::Devices::Midi2;
namespace loop  = winrt::Microsoft::Windows::Devices::Midi2::Endpoints::Loopback;
namespace init  = Microsoft::Windows::Devices::Midi2::Initialization;

namespace {

struct VirtualPort {
    std::string name;
    winrt::guid association{};
    midi2::MidiEndpointConnection connection{ nullptr };
};

std::unique_ptr<init::MidiDesktopAppSdkInitializer> g_init;
midi2::MidiSession g_session{ nullptr };
std::string g_status = "Not started";
bool g_ready = false;

std::mutex g_lock;
std::vector<VirtualPort> g_ports;
midi2::MidiEndpointConnection g_input{ nullptr };
midi2::MidiEndpointConnection g_output{ nullptr };
std::vector<winrt::hstring> g_endpointIds;

// Turns one UMP into classic MIDI 1.0 bytes. Returns false for messages
// RICO doesn't route (SysEx, utility, flex data, ...).
bool umpToMidi1(uint32_t w0, uint32_t w1, std::vector<unsigned char>& out) {
    uint8_t type = (w0 >> 28) & 0xF;
    uint8_t status = (w0 >> 16) & 0xFF;
    uint8_t a = (w0 >> 8) & 0xFF;
    uint8_t b = w0 & 0xFF;
    out.clear();

    if (type == 0x1) {                    // system common / real time
        out.push_back(status);
        if (status == 0xF1 || status == 0xF3) out.push_back(a & 0x7F);
        if (status == 0xF2) { out.push_back(a & 0x7F); out.push_back(b & 0x7F); }
        return true;
    }
    if (type == 0x2) {                    // MIDI 1.0 channel voice
        uint8_t kind = status & 0xF0;
        out.push_back(status);
        out.push_back(a & 0x7F);
        if (kind != 0xC0 && kind != 0xD0) out.push_back(b & 0x7F);
        return true;
    }
    if (type == 0x4) {                    // MIDI 2.0 channel voice, scaled down
        uint8_t kind = status & 0xF0;
        uint8_t ch = status & 0x0F;
        switch (kind) {
        case 0x80: case 0x90: {
            uint8_t vel = (uint8_t)(w1 >> 25);
            if (kind == 0x90 && vel == 0 && (w1 >> 16) != 0) vel = 1;
            out = { status, (unsigned char)(a & 0x7F), vel };
            return true;
        }
        case 0xA0: out = { status, (unsigned char)(a & 0x7F), (unsigned char)(w1 >> 25) }; return true;
        case 0xB0: out = { status, (unsigned char)(a & 0x7F), (unsigned char)(w1 >> 25) }; return true;
        case 0xC0: out = { status, (unsigned char)((w1 >> 24) & 0x7F) }; return true;
        case 0xD0: out = { status, (unsigned char)(w1 >> 25) }; return true;
        case 0xE0: {
            uint32_t v = w1 >> 18;        // 14 bits
            out = { (unsigned char)(0xE0 | ch), (unsigned char)(v & 0x7F), (unsigned char)((v >> 7) & 0x7F) };
            return true;
        }
        }
    }
    return false;
}

bool midi1ToUmp(const std::vector<unsigned char>& m, uint32_t& w0) {
    if (m.empty()) return false;
    uint8_t status = m[0];
    uint8_t a = m.size() > 1 ? m[1] : 0;
    uint8_t b = m.size() > 2 ? m[2] : 0;
    if (status < 0x80 || status == 0xF0 || status == 0xF7) return false;
    uint32_t type = (status >= 0xF0) ? 0x1 : 0x2;
    w0 = (type << 28) | ((uint32_t)status << 16) | ((uint32_t)a << 8) | b;
    return true;
}

void onMessage(midi2::IMidiMessageReceivedEventSource const&, midi2::MidiMessageReceivedEventArgs const& args) {
    uint32_t w0 = 0, w1 = 0, w2 = 0, w3 = 0;
    args.FillWords(w0, w1, w2, w3);
    std::vector<unsigned char> bytes;
    if (umpToMidi1(w0, w1, bytes))
        ProcessMidiMessage(bytes, -1);
}

std::string uniqueIdFor(const std::string& name) {
    std::string id = "rico";
    for (char c : name)
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) id += c;
    if (id.size() > 28) id.resize(28);
    return id;
}

std::vector<midi2::MidiEndpointDeviceInformation> endpoints() {
    std::vector<midi2::MidiEndpointDeviceInformation> list;
    auto all = midi2::MidiEndpointDeviceInformation::FindAll(
        midi2::MidiEndpointDeviceInformationSortOrder::Name,
        midi2::MidiEndpointDeviceInformationFilters::AllStandardEndpoints);
    for (auto const& d : all) list.push_back(d);
    return list;
}

} // namespace

bool WinMidi_IsCompiled() { return true; }
bool WinMidi_Ready() { return g_ready; }
const char* WinMidi_Status() { return g_status.c_str(); }

bool WinMidi_Init() {
    if (g_ready) return true;
    try {
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
    } catch (...) {
        // Already initialized on this thread, that's fine.
    }

    g_init = std::make_unique<init::MidiDesktopAppSdkInitializer>();
    if (!g_init->InitializeSdkRuntime()) {
        g_status = "Windows MIDI Services runtime is not installed. Get it from aka.ms/midi.";
        g_init.reset();
        return false;
    }
    if (!g_init->EnsureServiceAvailable()) {
        g_status = "The Windows MIDI Service is not running on this computer.";
        return false;
    }

    try {
        g_session = midi2::MidiSession::Create(L"RICO");
    } catch (winrt::hresult_error const& e) {
        g_status = "Could not open a MIDI session: " + winrt::to_string(e.message());
        return false;
    }
    if (!g_session) {
        g_status = "Could not open a MIDI session.";
        return false;
    }
    g_ready = true;
    g_status = "Ready";
    return true;
}

void WinMidi_Shutdown() {
    WinMidi_RemoveAllVirtualPorts();
    WinMidi_CloseDevices();
    if (g_session) {
        g_session.Close();
        g_session = nullptr;
    }
    g_init.reset();
    g_ready = false;
}

std::vector<std::string> WinMidi_EndpointNames() {
    std::vector<std::string> names;
    g_endpointIds.clear();
    if (!g_ready) return names;
    try {
        for (auto const& d : endpoints()) {
            names.push_back(winrt::to_string(d.Name()));
            g_endpointIds.push_back(d.EndpointDeviceId());
        }
    } catch (...) {}
    return names;
}

static midi2::MidiEndpointConnection connectTo(int index, bool listen) {
    if (!g_ready) return nullptr;
    if (g_endpointIds.empty()) WinMidi_EndpointNames();
    if (index < 0 || index >= (int)g_endpointIds.size()) return nullptr;
    try {
        auto c = g_session.CreateEndpointConnection(g_endpointIds[index]);
        if (listen) c.MessageReceived(&onMessage);
        if (!c.Open()) return nullptr;
        return c;
    } catch (...) {
        return nullptr;
    }
}

bool WinMidi_OpenInput(int index) {
    std::lock_guard<std::mutex> l(g_lock);
    if (g_input) { g_session.DisconnectEndpointConnection(g_input.ConnectionId()); g_input = nullptr; }
    g_input = connectTo(index, true);
    return (bool)g_input;
}

bool WinMidi_OpenOutput(int index) {
    std::lock_guard<std::mutex> l(g_lock);
    if (g_output) { g_session.DisconnectEndpointConnection(g_output.ConnectionId()); g_output = nullptr; }
    g_output = connectTo(index, false);
    return (bool)g_output;
}

void WinMidi_Send(const std::vector<unsigned char>& bytes) {
    uint32_t w0;
    if (!g_output || !midi1ToUmp(bytes, w0)) return;
    g_output.SendSingleMessageWords(midi2::MidiClock::TimestampConstantSendImmediately(), w0);
}

void WinMidi_CloseDevices() {
    std::lock_guard<std::mutex> l(g_lock);
    try {
        if (g_input) g_session.DisconnectEndpointConnection(g_input.ConnectionId());
        if (g_output) g_session.DisconnectEndpointConnection(g_output.ConnectionId());
    } catch (...) {}
    g_input = nullptr;
    g_output = nullptr;
}

bool WinMidi_CreateVirtualPort(const std::string& name) {
    if (!g_ready && !WinMidi_Init()) return false;
    std::lock_guard<std::mutex> l(g_lock);
    for (auto const& p : g_ports)
        if (p.name == name) return true;

    std::string id = uniqueIdFor(name);
    loop::MidiLoopbackEndpointDefinition outside;
    outside.Name = winrt::to_hstring(name);
    outside.UniqueId = winrt::to_hstring(id + "A");
    outside.Description = L"Virtual port made by RICO";

    loop::MidiLoopbackEndpointDefinition inside;
    inside.Name = winrt::to_hstring(name + " (RICO)");
    inside.UniqueId = winrt::to_hstring(id + "B");
    inside.Description = L"RICO side of the virtual port";

    winrt::guid association;
    if (FAILED(CoCreateGuid(reinterpret_cast<GUID*>(&association)))) return false;

    try {
        loop::MidiLoopbackEndpointCreationConfig config(association, outside, inside);
        auto result = loop::MidiLoopbackEndpointManager::CreateTransientLoopbackEndpoints(config);
        if (!result.Success) {
            g_status = "Could not create virtual port: " + winrt::to_string(result.ErrorInformation);
            return false;
        }

        VirtualPort port;
        port.name = name;
        port.association = association;
        port.connection = g_session.CreateEndpointConnection(result.EndpointDeviceIdB);
        port.connection.MessageReceived(&onMessage);
        if (!port.connection.Open()) {
            loop::MidiLoopbackEndpointManager::RemoveTransientLoopbackEndpoints(
                loop::MidiLoopbackEndpointRemovalConfig(association));
            g_status = "Virtual port was created but RICO could not open it.";
            return false;
        }
        g_ports.push_back(port);
        return true;
    } catch (winrt::hresult_error const& e) {
        g_status = "Could not create virtual port: " + winrt::to_string(e.message());
    } catch (...) {
        g_status = "Could not create virtual port.";
    }
    return false;
}

static void removePort(VirtualPort& p) {
    try {
        if (p.connection) g_session.DisconnectEndpointConnection(p.connection.ConnectionId());
        loop::MidiLoopbackEndpointManager::RemoveTransientLoopbackEndpoints(
            loop::MidiLoopbackEndpointRemovalConfig(p.association));
    } catch (...) {}
    p.connection = nullptr;
}

void WinMidi_RemoveVirtualPort(const std::string& name) {
    std::lock_guard<std::mutex> l(g_lock);
    for (size_t i = 0; i < g_ports.size(); ++i) {
        if (g_ports[i].name == name) {
            removePort(g_ports[i]);
            g_ports.erase(g_ports.begin() + i);
            return;
        }
    }
}

void WinMidi_RemoveAllVirtualPorts() {
    std::lock_guard<std::mutex> l(g_lock);
    for (auto& p : g_ports) removePort(p);
    g_ports.clear();
}

void WinMidi_SendToVirtualPorts(const std::vector<unsigned char>& bytes) {
    uint32_t w0;
    if (!midi1ToUmp(bytes, w0)) return;
    std::lock_guard<std::mutex> l(g_lock);
    for (auto& p : g_ports)
        if (p.connection)
            p.connection.SendSingleMessageWords(midi2::MidiClock::TimestampConstantSendImmediately(), w0);
}

#endif
