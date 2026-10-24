#pragma once
#include <string>
#include <sstream>
#include "imgui.h"

template<typename T>
T SafeClamp(T value, T min_val, T max_val) {
    return (value < min_val) ? min_val : (value > max_val) ? max_val : value;
}

inline ImVec4 HexToImVec4(const std::string& hex) {
    if (hex.length() != 7 || hex[0] != '#')
        return ImVec4(0.2f, 0.4f, 0.8f, 1.0f);
    unsigned int color;
    std::stringstream ss;
    ss << std::hex << hex.substr(1);
    ss >> color;
    return ImVec4(
        ((color >> 16) & 0xFF) / 255.0f,
        ((color >> 8) & 0xFF) / 255.0f,
        (color & 0xFF) / 255.0f,
        1.0f);
}

inline std::string MidiNoteToName(int note) {
    static const char* names[] = {
        "C","C#","D","D#","E","F","F#","G","G#","A","A#","B"
    };
    if (note < 0 || note > 127) return "---";
    char buf[16];
    snprintf(buf, sizeof(buf), "%s%d (%d)",
        names[note % 12], (note / 12) - 1, note);
    return buf;
}