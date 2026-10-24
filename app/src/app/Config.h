#pragma once

struct Config {
    bool sendToOSC = true;
    bool sendToMIDI = false;
    bool receiveFromOSC = true;
    bool midiThru = false;
    bool showMessageLog = false;
    bool showMappingEditor = true;
    bool autoConnectMIDI = true;

    char oscAddress[128] = "/midi";
    char oscIP[64] = "127.0.0.1";
    char presetName[64] = "Unreal Engine";

    int oscSendPort = 8000;
    int oscListenPort = 8001;
    int midiInDevice = -1;
    int midiOutDevice = -1;

    float uiScale = 1.0f;
    int colorTheme = 0;

    char customColorHex[8] = "#0600ff";
    char customColorHex2[8] = "#14092e";
    char customColorHex3[8] = "#cf023c";
    char customColorHex4[8] = "#5000db";

    bool classicUI = false;      // true = the original ImGui interface
    bool shareOnNetwork = false; // other devices on the network may open the interface
};

extern Config g_config;