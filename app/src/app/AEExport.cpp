#include "src/ui/tabs/UICommon.h"

// ===== AFTER EFFECTS KEYFRAME RECORDING FUNCTIONS =====
void RecordAEKeyframe() {
    if (!g_aeRecState.active) return;

    auto now = std::chrono::steady_clock::now();
    float elapsed = std::chrono::duration<float>(now - g_aeRecState.startTime).count();

    AEKeyframeData frame;
    frame.time = elapsed;

    if (g_audioAnalyzer) {
        AudioBands bands = g_audioAnalyzer->GetBands();
        frame.audioLow = bands.low;
        frame.audioMid = bands.mid;
        frame.audioHigh = bands.high;
        frame.overall = bands.overall;
    }

    // Record active MIDI controls
    for (const auto& pair : g_controlMappings) {
        const ControlMapping& mapping = pair.second;
        if (mapping.isActive) {
            std::string cleanName = mapping.displayName;
            std::replace(cleanName.begin(), cleanName.end(), ' ', '_');
            frame.midiValues[cleanName] = mapping.normalizedValue;
        }
    }

    g_aeRecState.recording.push_back(frame);
}

void ExportAEKeyframes() {
    json j;
    j["duration"] = g_aeRecState.recording.empty() ? 0 : g_aeRecState.recording.back().time;
    j["frameCount"] = g_aeRecState.recording.size();
    j["frames"] = json::array();

    for (const auto& frame : g_aeRecState.recording) {
        json frameData;
        frameData["time"] = frame.time;
        frameData["audioLow"] = frame.audioLow;
        frameData["audioMid"] = frame.audioMid;
        frameData["audioHigh"] = frame.audioHigh;
        frameData["overall"] = frame.overall;

        for (const auto& midi : frame.midiValues) {
            frameData[midi.first] = midi.second;
        }

        j["frames"].push_back(frameData);
    }

    std::ofstream file(g_aeRecState.path);
    file << j.dump(2);
    file.close();
}