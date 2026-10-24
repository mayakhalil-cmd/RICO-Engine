#include "src/ui/tabs/UICommon.h"
#include "src/midi/WinMidi.h"

const char* g_midiBackendNames[2] = { "Classic Windows MIDI", "Windows MIDI Services" };

MidiBackend g_currentMidiBackend = MidiBackend::RtMidi;
std::unique_ptr<RtMidiIn> g_midiIn;
std::unique_ptr<RtMidiOut> g_midiOut;
bool g_midiInConnected = false;
bool g_midiOutConnected = false;
std::set<int> g_activeNotes;
std::mutex g_notesMutex;
std::chrono::steady_clock::time_point g_lastMidiActivity = std::chrono::steady_clock::now();
LoopMidiState g_loopMidi;
std::vector<VirtualMidiPort> g_virtualPorts;
char g_newVirtualPortName[64] = "RICO Port";

// Messages that came in through one of our own virtual ports carry this as
// user data, so MIDI thru doesn't echo them straight back.
static int s_fromVirtualPort = 0;

void MidiCallback(double timeStamp, std::vector<unsigned char>* message, void* userData);
void ProcessMidiMessage(const std::vector<unsigned char>& message, int deviceIndex);
void AutoConnectMIDI();

std::vector<std::string> GetMidiInDeviceNames() {
    std::vector<std::string> names;
    if (g_currentMidiBackend == MidiBackend::WindowsMidi)
        return WinMidi_EndpointNames();
    if (g_midiIn)
        for (unsigned int i = 0; i < g_midiIn->getPortCount(); i++)
            names.push_back(g_midiIn->getPortName(i));
    return names;
}

std::vector<std::string> GetMidiOutDeviceNames() {
    std::vector<std::string> names;
    if (g_currentMidiBackend == MidiBackend::WindowsMidi)
        return WinMidi_EndpointNames();
    if (g_midiOut)
        for (unsigned int i = 0; i < g_midiOut->getPortCount(); i++)
            names.push_back(g_midiOut->getPortName(i));
    return names;
}

bool OpenMidiInput(int deviceIndex) {
    if (g_currentMidiBackend == MidiBackend::WindowsMidi) {
        g_midiInConnected = WinMidi_OpenInput(deviceIndex);
        return g_midiInConnected;
    }
    try {
        if (g_midiIn->isPortOpen()) g_midiIn->closePort();
        g_midiIn->openPort(deviceIndex);
        g_midiIn->setCallback(&MidiCallback);
        g_midiInConnected = true;
        return true;
    }
    catch (RtMidiError& e) {
        LogInfo("MIDI input error: %s", e.getMessage().c_str());
        g_midiInConnected = false;
        return false;
    }
}

bool OpenMidiOutput(int deviceIndex) {
    if (g_currentMidiBackend == MidiBackend::WindowsMidi) {
        g_midiOutConnected = WinMidi_OpenOutput(deviceIndex);
        return g_midiOutConnected;
    }
    try {
        if (g_midiOut->isPortOpen()) g_midiOut->closePort();
        g_midiOut->openPort(deviceIndex);
        g_midiOutConnected = true;
        return true;
    }
    catch (RtMidiError& e) {
        LogInfo("MIDI output error: %s", e.getMessage().c_str());
        g_midiOutConnected = false;
        return false;
    }
}

void SendMidiMessage(const std::vector<unsigned char>& message) {
    if (message.empty()) return;
    if (g_currentMidiBackend == MidiBackend::WindowsMidi) {
        WinMidi_Send(message);
        return;
    }
    if (g_midiOut && g_midiOut->isPortOpen())
        g_midiOut->sendMessage(&message);
}

void CloseMidiPorts() {
    if (g_midiIn && g_midiIn->isPortOpen()) g_midiIn->closePort();
    if (g_midiOut && g_midiOut->isPortOpen()) g_midiOut->closePort();
    WinMidi_CloseDevices();
    g_midiInConnected = false;
    g_midiOutConnected = false;
}

void SwitchMidiBackend(MidiBackend newBackend) {
    if (newBackend == g_currentMidiBackend) return;
    if (newBackend == MidiBackend::WindowsMidi && !WinMidi_Init()) {
        LogInfo("Windows MIDI Services: %s", WinMidi_Status());
        return;
    }
    CloseMidiPorts();
    g_currentMidiBackend = newBackend;
    g_config.midiInDevice = -1;
    g_config.midiOutDevice = -1;
    LogInfo("MIDI backend: %s", g_midiBackendNames[(int)newBackend]);
}

void ProcessMidiMessage(const std::vector<unsigned char>& message, int deviceIndex) {
    std::vector<unsigned char> msg = message;
    MidiCallback(0.0, &msg, deviceIndex < 0 ? &s_fromVirtualPort : nullptr);
}

// ---- Bridge ports --------------------------------------------------------
// Mirrors everything RICO receives to another MIDI port (OUT) and feeds
// another port into RICO (IN). Useful with DJ software and DAWs.

void BridgeInCallback(double timeStamp, std::vector<unsigned char>* message, void* userData) {
    if (!message || message->empty()) return;
    MidiCallback(timeStamp, message, userData);
}

void InitLoopMidiBridge(int portIndex) {
    if (g_loopMidi.out) { delete g_loopMidi.out; g_loopMidi.out = nullptr; }
    g_loopMidi.outEnabled = false;
    try {
        g_loopMidi.out = new RtMidiOut();
        if (portIndex < 0 || portIndex >= (int)g_loopMidi.out->getPortCount()) {
            delete g_loopMidi.out; g_loopMidi.out = nullptr;
            return;
        }
        g_loopMidi.out->openPort(portIndex, "RICO bridge out");
        g_loopMidi.outEnabled = true;
        LogInfo("Bridge out: %s", g_loopMidi.out->getPortName(portIndex).c_str());
    }
    catch (RtMidiError& e) {
        LogInfo("Bridge out error: %s", e.getMessage().c_str());
        delete g_loopMidi.out; g_loopMidi.out = nullptr;
    }
}

void InitLoopMidiBridgeIn(int portIndex) {
    if (g_loopMidi.in) {
        if (g_loopMidi.in->isPortOpen()) g_loopMidi.in->closePort();
        delete g_loopMidi.in; g_loopMidi.in = nullptr;
    }
    g_loopMidi.inEnabled = false;
    try {
        g_loopMidi.in = new RtMidiIn();
        if (portIndex < 0 || portIndex >= (int)g_loopMidi.in->getPortCount()) {
            delete g_loopMidi.in; g_loopMidi.in = nullptr;
            return;
        }
        g_loopMidi.in->openPort(portIndex, "RICO bridge in");
        g_loopMidi.in->setCallback(&BridgeInCallback);
        g_loopMidi.in->ignoreTypes(false, false, false);
        g_loopMidi.inEnabled = true;
        LogInfo("Bridge in: %s", g_loopMidi.in->getPortName(portIndex).c_str());
    }
    catch (RtMidiError& e) {
        LogInfo("Bridge in error: %s", e.getMessage().c_str());
        delete g_loopMidi.in; g_loopMidi.in = nullptr;
    }
}

void InitializeMIDI() {
    try {
        g_midiIn = std::make_unique<RtMidiIn>();
        g_midiOut = std::make_unique<RtMidiOut>();
        g_midiIn->setCallback(&MidiCallback);
        AutoConnectMIDI();
    }
    catch (RtMidiError& error) {
        LogInfo("MIDI could not start: %s", error.getMessage().c_str());
    }
    // Windows MIDI Services is started lazily, the first time someone makes
    // a virtual port or picks that backend, so RICO opens fast on PCs
    // without it.
}

void AutoConnectMIDI() {
    if (!g_config.autoConnectMIDI) return;
    try {
        if (g_midiIn && g_midiIn->getPortCount() > 0 && !g_midiIn->isPortOpen()) {
            g_midiIn->openPort(0);
            g_midiIn->setCallback(&MidiCallback);
            g_config.midiInDevice = 0;
            g_midiInConnected = true;
        }
        if (g_midiOut && g_midiOut->getPortCount() > 0 && !g_midiOut->isPortOpen()) {
            g_midiOut->openPort(0);
            g_config.midiOutDevice = 0;
            g_midiOutConnected = true;
        }
    }
    catch (RtMidiError& error) {
        LogInfo("MIDI auto-connect: %s", error.getMessage().c_str());
    }
}

// ---- Virtual ports -------------------------------------------------------

bool CreateNamedVirtualPort(const char* portName) {
    if (!portName || !*portName) return false;
    for (auto& p : g_virtualPorts)
        if (std::string(p.name) == portName) return true;

    if (!WinMidi_CreateVirtualPort(portName)) {
        LogInfo("Virtual port \"%s\": %s", portName, WinMidi_Status());
        return false;
    }
    VirtualMidiPort p;
    strncpy_s(p.name, sizeof(p.name), portName, _TRUNCATE);
    p.active = true;
    g_virtualPorts.push_back(p);
    LogInfo("Virtual port ready: %s", portName);
    return true;
}

void DestroyVirtualPort(int index) {
    if (index < 0 || index >= (int)g_virtualPorts.size()) return;
    WinMidi_RemoveVirtualPort(g_virtualPorts[index].name);
    g_virtualPorts.erase(g_virtualPorts.begin() + index);
}

void CreateNativeVirtualPorts() { CreateNamedVirtualPort(g_newVirtualPortName); }

void DestroyNativeVirtualPorts() {
    WinMidi_RemoveAllVirtualPorts();
    g_virtualPorts.clear();
}

// Every incoming MIDI message ends up here.
void MidiCallback(double timeStamp, std::vector<unsigned char>* message, void* userData) {
    if (message->size() < 2) return;

    unsigned char status = (*message)[0];
    unsigned char data1 = (*message)[1];
    unsigned char data2 = message->size() > 2 ? (*message)[2] : 0;

    int messageType = (status & 0xF0) >> 4;
    int channel = (status & 0x0F) + 1;

    g_lastMidiActivity = std::chrono::steady_clock::now();

    // Route to Art-Net DMX
    if (g_artnetState.initialized && messageType == 11) { // CC only
        float normalized = data2 / 127.0f;
        RouteArtNetMappings(data1, channel, normalized);
        SendArtNetDMX();
    }

    // MIDI thru: pass everything on to the selected output, and out of
    // RICO's virtual ports so other apps can listen to the merged stream.
    if (g_config.midiThru) {
        SendMidiMessage(*message);
        if (userData != &s_fromVirtualPort)
            WinMidi_SendToVirtualPorts(*message);
    }

    // Bridge out: mirror every message to a second port
    if (g_loopMidi.outEnabled && g_loopMidi.out) {
        g_loopMidi.out->sendMessage(message);
    }

    // Track active notes for live display
    if (messageType == 9 && data2 > 0) { // Note on
        std::lock_guard<std::mutex> lock(g_notesMutex);
        g_activeNotes.insert(data1);
    }
    else if (messageType == 8 || (messageType == 9 && data2 == 0)) { // Note off
        std::lock_guard<std::mutex> lock(g_notesMutex);
        g_activeNotes.erase(data1);
    }

    // Create log entry
    MidiMessage logMsg;
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    char timeStr[100];
    std::tm localTm{};
    localtime_s(&localTm, &time_t);
    strftime(timeStr, sizeof(timeStr), "%H:%M:%S", &localTm);
    logMsg.timestamp = timeStr;
    logMsg.channel = channel;
    logMsg.data1 = data1;
    logMsg.data2 = data2;

    // Parse message type and assign data types
    int controlType = -1;
    std::string typeStr;
    std::string dataType;

    switch (messageType) {
    case 9: // Note On
        if (data2 == 0) { // Note On with velocity 0 = Note Off
            controlType = 0;
            typeStr = "Note Off";
            dataType = "Boolean";
        }
        else {
            controlType = 0;
            typeStr = "Note On";
            dataType = "Boolean";
        }
        break;
    case 8: // Note Off
        controlType = 0;
        typeStr = "Note Off";
        dataType = "Boolean";
        break;
    case 11: // Control Change
        controlType = 1;
        typeStr = "CC";
        dataType = "Float";
        break;
    case 14: // Pitch Bend
        controlType = 2;
        typeStr = "Pitch Bend";
        dataType = "Float";
        break;
    case 12: // Program Change
        controlType = 3;
        typeStr = "Program";
        dataType = "Integer";
        break;
    case 13: // Channel Aftertouch
        controlType = 4;
        typeStr = "Aftertouch";
        dataType = "Float";
        break;
    default:
        typeStr = "Other";
        dataType = "Unknown";
        break;
    }

    logMsg.type = typeStr;
    logMsg.description = typeStr + " Ch:" + std::to_string(channel) + " " + std::to_string(data1) + ":" + std::to_string(data2);

    // Handle learning mode or auto-create mappings ====
    if (controlType >= 0) {
        std::string key = std::to_string(controlType) + ":" + std::to_string(channel) + ":" + std::to_string(data1);

        if (g_learningMapping) {
            g_learningMapping->controlType = controlType;
            g_learningMapping->channel = channel;
            g_learningMapping->controller = data1;
            g_learningMapping->dataType = dataType;
            g_learningMapping->isLearning = false;

            // Generate display name
            g_learningMapping->displayName = typeStr + " Ch" + std::to_string(channel) + ":" + std::to_string(data1);

            // Generate OSC address if empty
            if (g_learningMapping->oscAddress.empty()) {
                std::string baseAddr = g_config.oscAddress;
                if (baseAddr.back() != '/') baseAddr += "/";
                g_learningMapping->oscAddress = baseAddr + "ctrl" + std::to_string(g_controlMappings.size());
            }

            g_learningMapping = nullptr;
        }
        else if (g_controlMappings.find(key) == g_controlMappings.end()) {

            // Auto-create mapping
            ControlMapping newMapping;
            newMapping.controlType = controlType;
            newMapping.channel = channel;
            newMapping.controller = data1;
            newMapping.dataType = dataType;
            newMapping.displayName = typeStr + " Ch" + std::to_string(channel) + ":" + std::to_string(data1);

            std::string baseAddr = g_config.oscAddress;
            if (baseAddr.back() != '/') baseAddr += "/";
            newMapping.oscAddress = baseAddr + "ctrl" + std::to_string(g_controlMappings.size() + 1);

            // Set appropriate ranges based on type
            if (controlType == 0) { // Notes
                newMapping.isMomentary = true;
            }

            g_controlMappings[key] = newMapping;
        }
    }

    // Send the mapped OSC message to the main target and every destination
    if (g_config.sendToOSC && controlType >= 0) {
        std::string key = std::to_string(controlType) + ":" + std::to_string(channel) + ":" + std::to_string(data1);
        auto it = g_controlMappings.find(key);
        if (it != g_controlMappings.end()) {
            ControlMapping& mapping = it->second;
            mapping.isActive = true;
            mapping.normalizedValue = (controlType == (int)MidiControlType::Note)
                ? (data2 > 0 ? 1.0f : 0.0f) : data2 / 127.0f;

            if (g_oscSender) {
                try {
                    char buffer[1024];
                    osc::OutboundPacketStream p(buffer, 1024);

                    // Send typed OSC data based on control type
                    switch (controlType) {
                    case (int)MidiControlType::Note: // send integer 0 or 1
                        p << osc::BeginMessage(mapping.oscAddress.c_str())
                            << (data2 > 0 ? 1 : 0) // 1 for note on, 0 for note off
                            << osc::EndMessage;
                        // Also send to all additional destinations
                        SendOSCToAllDestinations(mapping.oscAddress.c_str(), (data2 > 0 ? 1 : 0));
                        break;
                    case (int)MidiControlType::CC:
                    {
                        float normalized = data2 / 127.0f;
                        float scaled = mapping.minValue + normalized * (mapping.maxValue - mapping.minValue);
                        p << osc::BeginMessage(mapping.oscAddress.c_str())
                            << scaled
                            << osc::EndMessage;
                        //Also send to all additional destinations
                        SendOSCToAllDestinations(mapping.oscAddress.c_str(), scaled);
                    }
                    break;
                    case (int)MidiControlType::PitchBend:
                    {
                        int pitchValue = data1 | (data2 << 7);
                        float normalized = (pitchValue - 8192.0f) / 8192.0f;
                        float scaled = mapping.minValue + (normalized + 1.0f) * 0.5f * (mapping.maxValue - mapping.minValue);
                        p << osc::BeginMessage(mapping.oscAddress.c_str())
                            << scaled
                            << osc::EndMessage;

                        // Also send to all additional destinations
                        SendOSCToAllDestinations(mapping.oscAddress.c_str(), scaled);
                    }
                    break;
                    case (int)MidiControlType::ProgramChange: // send integer
                        p << osc::BeginMessage(mapping.oscAddress.c_str())
                            << static_cast<int>(data1)
                            << osc::EndMessage;
                        // Also send to all additional destinations
                        SendOSCToAllDestinations(mapping.oscAddress.c_str(), static_cast<int>(data1));
                        break;
                    case (int)MidiControlType::Aftertouch:
                    {
                        float normalized = data1 / 127.0f;
                        float scaled = mapping.minValue + normalized * (mapping.maxValue - mapping.minValue);
                        p << osc::BeginMessage(mapping.oscAddress.c_str())
                            << scaled
                            << osc::EndMessage;
                        // Also send to all additional destinations
                        SendOSCToAllDestinations(mapping.oscAddress.c_str(), scaled);
                    }
                    break;
                    }

                    g_oscSender->Send(p.Data(), p.Size());
                    logMsg.oscAddress = mapping.oscAddress;
                    logMsg.normalizedValue = data2 / 127.0f;

                }
                catch (std::exception& e) {
                    LogInfo("OSC send error: %s", e.what());
                }
            }
        }
    }

    // Add to log safely
    std::lock_guard<std::mutex> lock(g_logMutex);
    PushLogLocked(logMsg);
}