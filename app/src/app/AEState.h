#pragma once
#include <vector>
#include <chrono>

struct AEKeyframeData; 

struct AERecordingState {
    std::vector<AEKeyframeData> recording;
    bool active = false;
    std::chrono::steady_clock::time_point startTime;
    char path[260] = "";      // set at startup, inside the data folder
    bool liveExport = false;
    char livePath[260] = "";
};