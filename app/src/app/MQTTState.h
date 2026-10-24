#pragma once
#include <string>

struct MQTTState {
    char broker[128] = "tcp://127.0.0.1:1883";
    char clientID[64] = "RICO";
    char username[64] = "";
    char password[64] = "";
    bool connected = false;
    bool connecting = false;
    std::string status = "Not connected";
};

extern MQTTState g_mqttState;