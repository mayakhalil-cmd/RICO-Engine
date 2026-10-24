#pragma once

enum class MidiBackend {
    RtMidi = 0,        // classic Windows MIDI (WinMM), works everywhere
    WindowsMidi = 1    // Windows MIDI Services, Windows 11
};

extern const char* g_midiBackendNames[2];

struct MidiState {
    bool inConnected = false;
    bool outConnected = false;
    MidiBackend backend = MidiBackend::RtMidi;
    int loopOutPortIndex = -1;
    int loopInPortIndex = -1;
    char loopOutPortName[128] = "";
    char loopInPortName[128] = "";
    bool loopBridgeOutEnabled = false;
    bool loopBridgeInEnabled = false;
    bool useNativeVirtualPort = false;
};

extern MidiState g_midiState;
