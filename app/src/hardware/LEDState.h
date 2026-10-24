#pragma once

struct RGBColor {
    int r = 255, g = 255, b = 255;
    float rf() const { return r / 255.f; }
    float gf() const { return g / 255.f; }
    float bf() const { return b / 255.f; }
};

struct LedState {
    bool connected = false;
    char port[16] = "COM4";
    int numLEDs = 320;
    float brightness = 0.5f;
    int currentPattern = 7;
    float speed = 1.0f;
    int reactivity = 70;
    bool audioReactive = true;
    float fadeSpeed = 6.0f;
    bool patternReverse = false;
    bool useRawBands = true;
    float lowGain = 1.0f;
    float midGain = 1.0f;
    float highGain = 1.0f;
    float noiseFloor = 0.05f;
    bool freqBrightness = true;
    int brightnessThresholdHz = 500;
    float brightnessBelowThreshold = 0.3f;
    float brightnessAboveThreshold = 1.0f;
    bool comboGradientMode = true;
    float comboBassIntensity = 1.5f;
    float comboSparkIntensity = 1.2f;

    RGBColor baseColor = { 255, 100, 50 };
    RGBColor audioBarsColor = { 255, 0, 0 };
    RGBColor sparkColor = { 0, 100, 255 };
};

extern LedState g_ledState;