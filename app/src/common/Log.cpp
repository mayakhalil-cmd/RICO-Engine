#include "Log.h"
#include <chrono>
#include <sstream>
#include <iomanip>
#include <cstdarg>
#include <cstdio>

std::vector<MidiMessage> g_messageLog;
std::mutex               g_logMutex;

void PushLogLocked(MidiMessage entry) {
    static unsigned long long serial = 0;
    entry.serial = ++serial;
    if (g_messageLog.size() >= 1000)
        g_messageLog.erase(g_messageLog.begin());
    g_messageLog.push_back(std::move(entry));
}

std::string GetCurrentTimestamp() {
    auto now = std::chrono::system_clock::now();
    auto tt = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
    localtime_s(&tm, &tt);
    std::ostringstream ss;
    ss << std::put_time(&tm, "%H:%M:%S");
    return ss.str();
}

void LogMessage(
    const std::string& type,
    const std::string& description,
    const std::string& oscAddress,
    float value,
    int channel)
{
    std::lock_guard<std::mutex> lock(g_logMutex);
    MidiMessage e;
    e.timestamp = GetCurrentTimestamp();
    e.type = type;
    e.description = description;
    e.oscAddress = oscAddress;
    e.normalizedValue = value;
    e.channel = channel;
    PushLogLocked(e);
}

void LogInfo(const char* fmt, ...) {
    char buf[512];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    LogMessage("RICO", buf, "", 0.0f, -1);
}
