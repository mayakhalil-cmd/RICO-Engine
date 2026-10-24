#pragma once
#include <mutex>
#include <vector>
#include <string>

struct MidiMessage {
    std::string timestamp;
    std::string type;
    int channel = -1, data1 = -1, data2 = -1;
    std::string description;
    std::string oscAddress;
    float normalizedValue = 0.0f;
    unsigned long long serial = 0;   // increases by one for every entry
};

extern std::vector<MidiMessage> g_messageLog;
extern std::mutex               g_logMutex;

std::string GetCurrentTimestamp();

// Adds an entry and keeps the log at 1000 entries.
// The caller must hold g_logMutex.
void PushLogLocked(MidiMessage entry);

void LogMessage(
    const std::string& type,
    const std::string& description,
    const std::string& oscAddress,
    float value,
    int channel);

// Short status line for the log, printf style. Shows up as type "RICO".
void LogInfo(const char* fmt, ...);
