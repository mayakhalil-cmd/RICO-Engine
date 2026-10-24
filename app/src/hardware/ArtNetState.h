#pragma once
#include <cstdint>
#include <string>

struct ArtNetState {
    bool initialized = false;
    char targetIP[64] = "255.255.255.255";
    int universe = 0;
    int sequence = 0;
    uint8_t dmxData[512] = {};
};

extern ArtNetState g_artnetState;