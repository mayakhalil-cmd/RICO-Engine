#pragma once
#include <string>
#include <vector>

struct AudioState {
    bool capturing = false;
    int selectedDevice = -1;
    std::string currentDeviceName = "System Default";
    std::vector<std::string> deviceNames;
};

extern AudioState g_audioState;