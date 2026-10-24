#pragma once

struct GuitarState {
    bool enabled = false;
    bool polyphonic = false;
    int midiChannel = 1;
    int velocity = 100;
    float sensitivity = 0.7f;
    bool pitchBend = false;
    bool sendToOSC = true;
    float inputGain = 8.0f;
    float noiseGate = 0.001f;
};

extern GuitarState g_guitarState;