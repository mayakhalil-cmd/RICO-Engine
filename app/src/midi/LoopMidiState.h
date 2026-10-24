#pragma once
#include "RtMidi.h"

struct LoopMidiState {
    RtMidiOut* out = nullptr;
    RtMidiIn* in = nullptr;
    bool outEnabled = false;
    bool inEnabled = false;
    int  outPortIndex = -1;
    int  inPortIndex = -1;
    char outPortName[128] = "";
    char inPortName[128] = "";
};