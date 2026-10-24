#include "src/ui/tabs/UICommon.h"

void DrawMultimedia_LEDStripSubTab() {
    ImGui::Text("WS2811 LED Strip Control via Raspberry Pi Pico");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    ImGui::InputText("COM Port", g_ledState.port, sizeof(g_ledState.port));
    ImGui::SameLine();
    if (ImGui::Button("Connect##LED")) {
        g_ledState.connected = g_ledStrip.Connect(g_ledState.port);
        if (g_ledState.connected) {
            g_ledStrip.SetNumLEDs(g_ledState.numLEDs);
            g_ledStrip.SetBrightness(g_ledState.brightness);
            g_ledStrip.SetPattern(g_ledState.currentPattern);
        }
    }
    ImGui::SameLine();
    if (ImGui::Button("Disconnect##LED")) { g_ledStrip.Disconnect(); g_ledState.connected = false; }

    if (g_ledState.connected) ImGui::TextColored(ImVec4(0,1,0,1), "[CONNECTED] LED Strip Ready");
    else                      ImGui::TextColored(ImVec4(1,0,0,1), "[DISCONNECTED] Not Connected");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("Strip Configuration:");
    if (ImGui::InputInt("Number of LEDs", &g_ledState.numLEDs, 10, 50))
        if (g_ledState.connected) g_ledStrip.SetNumLEDs(g_ledState.numLEDs);
    ImGui::SameLine(); ImGui::TextDisabled("(~10 per foot, 32ft = 320 LEDs)");
    if (ImGui::SliderFloat("Global Brightness", &g_ledState.brightness, 0.0f, 1.0f))
        if (g_ledState.connected) g_ledStrip.SetBrightness(g_ledState.brightness);

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("Pattern Selection:");
    const char* patterns[] = {
        "0 - Solid Color", "1 - Rainbow Wave", "2 - Color Chase",
        "3 - Sparkle (Audio Reactive)", "4 - Strobe", "5 - Fire Effect",
        "6 - Audio Bars (Customizable Color)", "7 - Audio Pulse", "8 - Audio Wave",
        "9 - Gradient", "10 - Custom", "11 - Audio Bars + Spark Combo (NEW!)"
    };
    if (ImGui::Combo("Pattern", &g_ledState.currentPattern, patterns, 12))
        if (g_ledState.connected) g_ledStrip.SetPattern(g_ledState.currentPattern);
    if (ImGui::Checkbox("Reverse Pattern Direction", &g_ledState.patternReverse))
        if (g_ledState.connected) g_ledStrip.SendCommand(g_ledState.patternReverse ? "REVERSE:1" : "REVERSE:0");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(1,1,0,1), "PATTERN-SPECIFIC COLOR CONTROLS"); ImGui::Spacing();

    if (g_ledState.currentPattern == 6) {
        ImGui::Text("Audio Bars Color (Pattern 6):");
        float barsColor[3] = { g_ledState.audioBarsColor.r/255.f, g_ledState.audioBarsColor.g/255.f, g_ledState.audioBarsColor.b/255.f };
        if (ImGui::ColorEdit3("Bars Color##AudioBars", barsColor, ImGuiColorEditFlags_NoAlpha)) {
            g_ledState.audioBarsColor.r = (int)(barsColor[0]*255); g_ledState.audioBarsColor.g = (int)(barsColor[1]*255); g_ledState.audioBarsColor.b = (int)(barsColor[2]*255);
            if (g_ledState.connected) { char cmd[64]; sprintf_s(cmd,"MAPLOW:%d,%d,%d",g_ledState.audioBarsColor.r,g_ledState.audioBarsColor.g,g_ledState.audioBarsColor.b); g_ledStrip.SendCommand(cmd); }
        }
    } else if (g_ledState.currentPattern == 3) {
        ImGui::Text("Sparkle Color (Pattern 3):");
        float sparkColor[3] = { g_ledState.sparkColor.r/255.f, g_ledState.sparkColor.g/255.f, g_ledState.sparkColor.b/255.f };
        if (ImGui::ColorEdit3("Spark Color##Sparkle", sparkColor, ImGuiColorEditFlags_NoAlpha)) {
            g_ledState.sparkColor.r = (int)(sparkColor[0]*255); g_ledState.sparkColor.g = (int)(sparkColor[1]*255); g_ledState.sparkColor.b = (int)(sparkColor[2]*255);
            if (g_ledState.connected) g_ledStrip.SetColor(g_ledState.sparkColor.r, g_ledState.sparkColor.g, g_ledState.sparkColor.b);
        }
    } else if (g_ledState.currentPattern == 11) {
        ImGui::TextColored(ImVec4(0,1,1,1), "COMBO PRESET: Audio Bars (Bass) + Spark (Highs)"); ImGui::Spacing();
        ImGui::Text("Audio Bars Color (0-200Hz Bass):");
        float barsColor[3] = { g_ledState.audioBarsColor.r/255.f, g_ledState.audioBarsColor.g/255.f, g_ledState.audioBarsColor.b/255.f };
        if (ImGui::ColorEdit3("Bars Color##Combo", barsColor, ImGuiColorEditFlags_NoAlpha)) {
            g_ledState.audioBarsColor.r=(int)(barsColor[0]*255); g_ledState.audioBarsColor.g=(int)(barsColor[1]*255); g_ledState.audioBarsColor.b=(int)(barsColor[2]*255);
        }
        ImGui::Spacing();
        ImGui::Text("Spark Color (200Hz+ Highs):");
        float sparkColor[3] = { g_ledState.sparkColor.r/255.f, g_ledState.sparkColor.g/255.f, g_ledState.sparkColor.b/255.f };
        if (ImGui::ColorEdit3("Spark Color##Combo", sparkColor, ImGuiColorEditFlags_NoAlpha)) {
            g_ledState.sparkColor.r=(int)(sparkColor[0]*255); g_ledState.sparkColor.g=(int)(sparkColor[1]*255); g_ledState.sparkColor.b=(int)(sparkColor[2]*255);
        }
        ImGui::Spacing();
        ImGui::Text("Intensity Controls:");
        ImGui::SliderFloat("Bass Bars Intensity", &g_ledState.comboBassIntensity, 0.5f, 3.0f, "%.2fx");
        ImGui::SliderFloat("Spark Intensity",     &g_ledState.comboSparkIntensity, 0.5f, 3.0f, "%.2fx");
        ImGui::Spacing();
        ImGui::Checkbox("Gradient Blend Mode", &g_ledState.comboGradientMode);
        ImGui::SameLine(); ImGui::TextDisabled("(Smooth color blend instead of solid)");
        if (ImGui::Button("Apply Combo Colors", ImVec2(200,30))) {
            if (g_ledState.connected) {
                char cmd1[64],cmd2[64];
                sprintf_s(cmd1,"MAPLOW:%d,%d,%d",g_ledState.audioBarsColor.r,g_ledState.audioBarsColor.g,g_ledState.audioBarsColor.b);
                g_ledStrip.SendCommand(cmd1);
                sprintf_s(cmd2,"MAPHIGH:%d,%d,%d",g_ledState.sparkColor.r,g_ledState.sparkColor.g,g_ledState.sparkColor.b);
                g_ledStrip.SendCommand(cmd2);
            }
        }
    } else {
        ImGui::Text("Base Color (Non-Audio Patterns):");
        float color[3] = { g_ledState.baseColor.r/255.f, g_ledState.baseColor.g/255.f, g_ledState.baseColor.b/255.f };
        if (ImGui::ColorEdit3("Color##LED", color, ImGuiColorEditFlags_NoAlpha)) {
            g_ledState.baseColor.r=(int)(color[0]*255); g_ledState.baseColor.g=(int)(color[1]*255); g_ledState.baseColor.b=(int)(color[2]*255);
            if (g_ledState.connected) g_ledStrip.SetColor(g_ledState.baseColor.r, g_ledState.baseColor.g, g_ledState.baseColor.b);
        }
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(1,0.5f,1,1), "FREQUENCY-BASED BRIGHTNESS"); ImGui::Spacing();
    ImGui::Checkbox("Enable Frequency Brightness", &g_ledState.freqBrightness);
    ImGui::SameLine(); ImGui::TextDisabled("(Dims on bass, brightens on highs)");
    if (g_ledState.freqBrightness) {
        ImGui::Spacing();
        ImGui::SliderInt("Threshold Frequency (Hz)", &g_ledState.brightnessThresholdHz, 200, 2000, "%d Hz");
        ImGui::SameLine(); ImGui::TextDisabled("(Above this = bright)");
        ImGui::SliderFloat("Brightness Below Threshold", &g_ledState.brightnessBelowThreshold, 0.1f, 1.0f, "%.0f%%");
        ImGui::SliderFloat("Brightness Above Threshold", &g_ledState.brightnessAboveThreshold, 0.5f, 1.0f, "%.0f%%");
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(1,1,0,1), "AUDIO REACTIVE CONTROLS");
    ImGui::Checkbox("Audio Reactive Mode", &g_ledState.audioReactive);
    ImGui::SameLine(); ImGui::TextDisabled("(Requires Audio Capture active)");
    if (g_ledState.audioReactive) {
        ImGui::Spacing();
        ImGui::Checkbox("Ultra-Low Latency Mode", &g_ledState.useRawBands); ImGui::Spacing();
        ImGui::Text("Band Gains:");
        ImGui::SliderFloat("Low (Bass) Gain",  &g_ledState.lowGain,  0.0f, 3.0f, "%.2fx");
        ImGui::SliderFloat("Mid Gain",         &g_ledState.midGain,  0.0f, 3.0f, "%.2fx");
        ImGui::SliderFloat("High (Treble) Gain",&g_ledState.highGain, 0.0f, 3.0f, "%.2fx");
        ImGui::Spacing();
        ImGui::SliderFloat("Noise Floor", &g_ledState.noiseFloor, 0.0f, 0.3f, "%.3f"); ImGui::Spacing();
        if (ImGui::SliderInt("Overall Reactivity", &g_ledState.reactivity, 0, 100, "%d%%"))
            if (g_ledState.connected) g_ledStrip.SetReactivity(g_ledState.reactivity);
        ImGui::Spacing(); ImGui::Text("Quick Audio Presets:");
        if (ImGui::Button("Bass Heavy"))   { g_ledState.lowGain=2.5f; g_ledState.midGain=0.5f; g_ledState.highGain=0.3f; g_ledState.noiseFloor=0.08f; } ImGui::SameLine();
        if (ImGui::Button("Balanced"))     { g_ledState.lowGain=1.0f; g_ledState.midGain=1.0f; g_ledState.highGain=1.0f; g_ledState.noiseFloor=0.05f; } ImGui::SameLine();
        if (ImGui::Button("Treble Focus")) { g_ledState.lowGain=0.3f; g_ledState.midGain=0.8f; g_ledState.highGain=2.5f; g_ledState.noiseFloor=0.03f; }
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    if (ImGui::SliderFloat("Animation Speed", &g_ledState.speed, 0.1f, 5.0f, "%.1fx"))
        if (g_ledState.connected) g_ledStrip.SetSpeed(g_ledState.speed);

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("Quick Combo Presets:");
    if (ImGui::Button("Combo: Red Bars + Blue Spark")) {
        g_ledState.currentPattern=11; g_ledState.audioBarsColor={255,0,0}; g_ledState.sparkColor={0,100,255};
        if (g_ledState.connected) g_ledStrip.SetPattern(11);
    }
    ImGui::SameLine();
    if (ImGui::Button("Combo: Purple Bars + Gold Spark")) {
        g_ledState.currentPattern=11; g_ledState.audioBarsColor={128,0,255}; g_ledState.sparkColor={255,200,0};
        if (g_ledState.connected) g_ledStrip.SetPattern(11);
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    if (ImGui::Button("STOP - All LEDs OFF", ImVec2(200,40)))
        if (g_ledState.connected) g_ledStrip.Stop();
}

void DrawMultimedia_AfterEffectsSubTab() {
    ImGui::TextColored(ImVec4(1,0.5f,0,1), "AFTER EFFECTS KEYFRAME RECORDING");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    static int mode = 0;
    ImGui::RadioButton("Live Preview Mode", &mode, 0); ImGui::SameLine(); ImGui::TextDisabled("(Real-time, no recording)");
    ImGui::RadioButton("Recording Mode",    &mode, 1); ImGui::SameLine(); ImGui::TextDisabled("(Captures for keyframe export)");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (mode == 0) {
        ImGui::TextColored(ImVec4(0,1,1,1), "LIVE PREVIEW MODE");
        ImGui::Checkbox("Enable Live Export", &g_aeRecState.liveExport);
        if (g_aeRecState.liveExport) {
            ImGui::InputText("Live Export Path", g_aeRecState.livePath, sizeof(g_aeRecState.livePath));
            ImGui::TextColored(ImVec4(0,1,0,1), "Exporting live data for RAM Preview");
        }
        ImGui::Spacing();
        ImGui::TextWrapped("Use this mode to experiment and see results in real-time. Switch to Recording Mode when ready!");
    } else {
        ImGui::TextColored(ImVec4(1,0.5f,0,1), "KEYFRAME RECORDING MODE");
        if (!g_aeRecState.active) {
            if (ImGui::Button("START RECORDING", ImVec2(200,50))) {
                g_aeRecState.recording.clear(); g_aeRecState.active = true;
                g_aeRecState.startTime = std::chrono::steady_clock::now();
            }
            ImGui::SameLine(); ImGui::TextDisabled("Click when ready to capture a perfect take");
        } else {
            auto elapsed = std::chrono::duration<float>(std::chrono::steady_clock::now() - g_aeRecState.startTime).count();
            ImGui::TextColored(ImVec4(1,0,0,1), "RECORDING... %.2f seconds", elapsed);
            ImGui::Text("Frames captured: %zu", g_aeRecState.recording.size());
            if (ImGui::Button("STOP RECORDING", ImVec2(200,50))) {
                g_aeRecState.active = false; ExportAEKeyframes(); ImGui::OpenPopup("ExportSuccess");
            }
        }
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (!g_aeRecState.recording.empty()) {
            ImGui::Text("Last Recording:");
            ImGui::BulletText("Duration: %.2f seconds", g_aeRecState.recording.back().time);
            ImGui::BulletText("Frames: %zu", g_aeRecState.recording.size());
            ImGui::InputText("Export Path", g_aeRecState.path, sizeof(g_aeRecState.path));
            if (ImGui::Button("Export Keyframes to JSON", ImVec2(200,40))) { ExportAEKeyframes(); ImGui::OpenPopup("ExportSuccess"); }
        }
    }

    if (ImGui::BeginPopupModal("ExportSuccess", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Text("Keyframes exported successfully!");
        ImGui::Spacing(); ImGui::TextColored(ImVec4(0,1,1,1), "Next Steps:");
        ImGui::BulletText("1. Open After Effects"); ImGui::BulletText("2. Import JSON file as Footage");
        ImGui::BulletText("3. Add expression to property"); ImGui::BulletText("4. Keyframes will animate automatically!");
        ImGui::Spacing();
        if (ImGui::Button("OK")) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(0.7f,0.7f,0.7f,1), "Spout connection is managed in the Spout tab.");
    ImGui::Separator();
    ImGui::TextColored(ImVec4(1,1,0,1), "WORKFLOW:");
    ImGui::TextWrapped("1. Use Live Preview Mode to experiment\n2. When you get a great take, switch to Recording Mode\n3. Click START RECORDING and perform\n4. Click STOP when done\n5. Export keyframes to After Effects!");
    ImGui::Spacing();
    ImGui::TextColored(ImVec4(0,1,1,1), "After Effects Expression:");
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.1f,0.1f,0.1f,1));
    if (ImGui::BeginChild("ExpressionCode", ImVec2(0,120), true)) {
        ImGui::Text("// Add this to any property:");
        ImGui::Text("var data = footage(\"recorded_performance.json\").sourceData;");
        ImGui::Text("var t = time;");
        ImGui::Text("var frame = null;");
        ImGui::Text("for (var i = 0; i < data.frames.length; i++) {");
        ImGui::Text("    if (Math.abs(data.frames[i].time - t) < 0.033) {");
        ImGui::Text("        frame = data.frames[i]; break;");
        ImGui::Text("    }");
        ImGui::Text("}");
        ImGui::Text("frame ? frame.audioLow * 100 : 0;");
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
}

void UpdateTimedSequences() {
    // Runs every frame from the engine loop, with or without the classic UI.
    static auto lastTick = std::chrono::steady_clock::now();
    auto tickNow = std::chrono::steady_clock::now();
    float deltaTime = std::chrono::duration<float>(tickNow - lastTick).count();
    lastTick = tickNow;

    for (auto& seq : g_sequences) {
        if (!seq.running || seq.paused) continue;

        auto now = std::chrono::steady_clock::now();
        seq.elapsed = std::chrono::duration<float>(now - seq.startTime).count() - seq.pausedDuration;

        float maxTime = 0.0f;
        for (auto& a : seq.actions) if (a.triggerTime > maxTime) maxTime = a.triggerTime;

        float loopTime = seq.loop ? seq.loopInterval : maxTime + 0.1f;
        float localTime = seq.loop ? fmodf(seq.elapsed, loopTime) : seq.elapsed;
        float prevLocalTime = localTime - deltaTime;

        for (auto& action : seq.actions) {
            if (!action.enabled) continue;
            if (!(localTime >= action.triggerTime && prevLocalTime < action.triggerTime)) continue;

            switch (action.type) {
            case SeqActionType::OSC:
                try {
                    char buffer[1024]; osc::OutboundPacketStream p(buffer, 1024);
                    p << osc::BeginMessage(action.oscAddress) << action.oscValue << osc::EndMessage;
                    UdpTransmitSocket socket(IpEndpointName(action.oscIP, action.oscPort));
                    socket.Send(p.Data(), p.Size());
                } catch (...) {}
                break;
            case SeqActionType::MIDI:
                {
                    std::vector<unsigned char> msg;
                    switch (action.midiType) {
                    case 0: msg = { (unsigned char)(0x90+action.midiChannel-1),(unsigned char)action.midiData1,(unsigned char)action.midiData2 }; break;
                    case 1: msg = { (unsigned char)(0xB0+action.midiChannel-1),(unsigned char)action.midiData1,(unsigned char)action.midiData2 }; break;
                    case 2: msg = { (unsigned char)(0xC0+action.midiChannel-1),(unsigned char)action.midiData1 }; break;
                    }
                    if (!msg.empty()) SendMidiMessage(msg);
                }
                break;
            case SeqActionType::DMX:
                SetDMXChannel(action.dmxChannel, action.dmxValue);
                if (g_artnetState.initialized) SendArtNetDMX();
                break;
            case SeqActionType::Serial:
                if (action.serialTarget == 0 && g_ledState.connected)
                    g_ledStrip.SendCommand(action.serialCommand);
                break;
            }
        }

        if (seq.loop) {
            int currentLoop = (int)(seq.elapsed / loopTime);
            if (seq.maxLoops > 0 && currentLoop >= seq.maxLoops) { seq.running = false; seq.elapsed = 0.0f; }
            else seq.loopCount = currentLoop;
        } else {
            if (seq.elapsed > maxTime + 0.5f) seq.running = false;
        }
    }
}

void DrawMultimedia_TimedSequencesSubTab() {
    ImGui::Text("Timed Sequence Automation - Trigger Any Protocol on a Timer");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    ImGui::BeginChild("SeqList", ImVec2(220, 0), true);
    ImGui::TextColored(ImVec4(0,1,1,1), "SEQUENCES");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (ImGui::Button("+ New", ImVec2(-1, 30))) {
        TimedSequenceV2 seq;
        sprintf_s(seq.name, "Sequence %d", (int)g_sequences.size() + 1);
        g_sequences.push_back(seq);
        g_selectedSequence = (int)g_sequences.size() - 1;
    }
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    for (int i = 0; i < (int)g_sequences.size(); i++) {
        auto& seq = g_sequences[i];
        bool selected = (g_selectedSequence == i);
        if      (seq.running && !seq.paused) ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0,0.4f,0,0.8f));
        else if (seq.paused)                 ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.4f,0.4f,0,0.8f));
        else                                 ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.2f,0.2f,0.2f,0.8f));
        if (ImGui::Selectable(seq.name, selected, 0, ImVec2(0,40))) g_selectedSequence = i;
        ImGui::PopStyleColor();
        if (seq.running) { ImGui::SameLine(); ImGui::TextColored(seq.paused ? ImVec4(1,1,0,1) : ImVec4(0,1,0,1), seq.paused ? "||" : ">"); }
    }

    if (!g_sequences.empty() && g_selectedSequence < (int)g_sequences.size()) {
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (ImGui::Button("Delete##seq", ImVec2(-1,25))) {
            g_sequences[g_selectedSequence].running = false;
            g_sequences.erase(g_sequences.begin() + g_selectedSequence);
            g_selectedSequence = SafeClamp(g_selectedSequence, 0, (int)g_sequences.size()-1);
        }
    }
    ImGui::EndChild();
    ImGui::SameLine();

    if (g_sequences.empty()) {
        ImGui::BeginChild("SeqEdit", ImVec2(0,0), true);
        ImGui::TextDisabled("Create a sequence on the left to get started");
        ImGui::EndChild();
        return;
    }

    g_selectedSequence = SafeClamp(g_selectedSequence, 0, (int)g_sequences.size()-1);
    auto& seq = g_sequences[g_selectedSequence];

    ImGui::BeginChild("SeqEdit", ImVec2(0,0), true);
    ImGui::InputText("Name##seqname", seq.name, sizeof(seq.name));
    ImGui::Spacing();
    ImGui::TextColored(ImVec4(0,1,1,1), "PLAYBACK"); ImGui::Spacing();

    if (!seq.running) {
        if (ImGui::Button("PLAY", ImVec2(80,35))) {
            seq.running=true; seq.paused=false; seq.elapsed=0.0f; seq.pausedDuration=0.0f; seq.loopCount=0;
            seq.startTime=std::chrono::steady_clock::now();
        }
    } else {
        if (seq.paused) {
            if (ImGui::Button("RESUME", ImVec2(80,35))) {
                auto now = std::chrono::steady_clock::now();
                seq.pausedDuration += std::chrono::duration<float>(now - seq.pauseTime).count();
                seq.paused = false;
            }
        } else {
            if (ImGui::Button("PAUSE", ImVec2(80,35))) { seq.paused=true; seq.pauseTime=std::chrono::steady_clock::now(); }
        }
        ImGui::SameLine();
        if (ImGui::Button("STOP", ImVec2(80,35))) { seq.running=false; seq.elapsed=0.0f; seq.loopCount=0; }
    }

    ImGui::SameLine(); ImGui::Spacing(); ImGui::SameLine();
    ImGui::Checkbox("Loop", &seq.loop);
    if (seq.loop) {
        ImGui::SameLine(); ImGui::SetNextItemWidth(100); ImGui::InputFloat("Interval (s)", &seq.loopInterval, 0.1f, 1.0f, "%.2f");
        seq.loopInterval = SafeClamp(seq.loopInterval, 0.1f, 3600.0f);
        ImGui::SameLine(); ImGui::SetNextItemWidth(60); ImGui::InputInt("Max Loops", &seq.maxLoops);
        ImGui::SameLine(); ImGui::TextDisabled("(0=inf)");
    }

    if (seq.running) {
        ImGui::Spacing();
        float maxTime = 0.0f;
        for (auto& a : seq.actions) if (a.triggerTime > maxTime) maxTime = a.triggerTime;
        float progress = seq.loop ? fmodf(seq.elapsed, seq.loopInterval)/seq.loopInterval : SafeClamp(seq.elapsed/(maxTime+0.1f),0.0f,1.0f);
        char overlayBuf[64];
        if (seq.loop) sprintf_s(overlayBuf,"Loop %d  %.2fs",seq.loopCount+1,seq.elapsed);
        else          sprintf_s(overlayBuf,"%.2fs / %.2fs",seq.elapsed,maxTime);
        ImGui::ProgressBar(progress, ImVec2(-1,20), overlayBuf);
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(0,1,1,1), "ACTIONS (%d)", (int)seq.actions.size());
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    static SeqActionType newActionType = SeqActionType::OSC;
    static float newActionTime = 0.0f;
    static char newActionName[64] = "Action";

    ImGui::SetNextItemWidth(90); ImGui::InputFloat("Time##newt", &newActionTime, 0.1f, 1.0f, "%.2fs");
    newActionTime = SafeClamp(newActionTime, 0.0f, 9999.0f);
    ImGui::SameLine();
    const char* typeNames[] = { "OSC","MIDI","DMX","Serial" };
    ImGui::SetNextItemWidth(100);
    int typeIdx = (int)newActionType;
    if (ImGui::Combo("##newtype", &typeIdx, typeNames, 4)) newActionType = (SeqActionType)typeIdx;
    ImGui::SameLine();
    ImGui::SetNextItemWidth(140); ImGui::InputText("##newname", newActionName, sizeof(newActionName));
    ImGui::SameLine();
    if (ImGui::Button("+ Add Action", ImVec2(110,0))) {
        SeqAction a; a.type=newActionType; a.triggerTime=newActionTime; strcpy_s(a.name, newActionName);
        seq.actions.push_back(a);
        std::sort(seq.actions.begin(), seq.actions.end(), [](const SeqAction& x, const SeqAction& y){ return x.triggerTime < y.triggerTime; });
        newActionTime += 0.5f;
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (ImGui::BeginTable("ActionsTable", 4, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_ScrollY)) {
        ImGui::TableSetupColumn("En",               ImGuiTableColumnFlags_WidthFixed, 25);
        ImGui::TableSetupColumn("Time / Name / Type", ImGuiTableColumnFlags_WidthFixed, 220);
        ImGui::TableSetupColumn("Parameters",       ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("Del",              ImGuiTableColumnFlags_WidthFixed, 30);
        ImGui::TableHeadersRow();

        ImVec4 typeColVec[] = { ImVec4(0,1,0.5f,1),ImVec4(1,0.8f,0,1),ImVec4(0.5f,0.5f,1,1),ImVec4(1,0.5f,0,1) };
        const char* typeLabels[] = { "OSC","MIDI","DMX","Serial" };
        std::vector<int> toDelete;

        for (int i = 0; i < (int)seq.actions.size(); i++) {
            auto& a = seq.actions[i];
            ImGui::TableNextRow();
            ImGui::TableNextColumn(); ImGui::Checkbox(("##aen"+std::to_string(i)).c_str(), &a.enabled);
            ImGui::TableNextColumn();
            ImGui::SetNextItemWidth(60); ImGui::InputFloat(("##at"+std::to_string(i)).c_str(), &a.triggerTime, 0,0,"%.2fs"); ImGui::SameLine();
            ImGui::SetNextItemWidth(100); ImGui::InputText(("##an"+std::to_string(i)).c_str(), a.name, sizeof(a.name)); ImGui::SameLine();
            ImGui::TextColored(typeColVec[(int)a.type], "[%s]", typeLabels[(int)a.type]);

            ImGui::TableNextColumn();
            switch (a.type) {
            case SeqActionType::OSC: {
                ImGui::SetNextItemWidth(150); ImGui::InputText(("##oaddr"+std::to_string(i)).c_str(), a.oscAddress, sizeof(a.oscAddress)); ImGui::SameLine();
                ImGui::SetNextItemWidth(60);  ImGui::InputFloat(("##oval"+std::to_string(i)).c_str(), &a.oscValue,0,0,"%.2f"); ImGui::SameLine();
                ImGui::TextDisabled("ip:"); ImGui::SameLine();
                ImGui::SetNextItemWidth(100); ImGui::InputText(("##oip"+std::to_string(i)).c_str(), a.oscIP, sizeof(a.oscIP)); ImGui::SameLine();
                ImGui::TextDisabled("port:"); ImGui::SameLine();
                ImGui::SetNextItemWidth(55);
                int port=a.oscPort; if (ImGui::InputInt(("##oport"+std::to_string(i)).c_str(),&port,0,0)) a.oscPort=SafeClamp(port,1,65535);
                break; }
            case SeqActionType::MIDI: {
                const char* midiTypes[]={"Note On","CC","Prog"};
                ImGui::SetNextItemWidth(80); ImGui::Combo(("##mtype"+std::to_string(i)).c_str(),&a.midiType,midiTypes,3); ImGui::SameLine();
                ImGui::SetNextItemWidth(45); ImGui::InputInt(("##mch"+std::to_string(i)).c_str(),&a.midiChannel); a.midiChannel=SafeClamp(a.midiChannel,1,16); ImGui::SameLine();
                ImGui::SetNextItemWidth(45); ImGui::InputInt(("##md1"+std::to_string(i)).c_str(),&a.midiData1); a.midiData1=SafeClamp(a.midiData1,0,127);
                if (a.midiType!=2) { ImGui::SameLine(); ImGui::SetNextItemWidth(45); ImGui::InputInt(("##md2"+std::to_string(i)).c_str(),&a.midiData2); a.midiData2=SafeClamp(a.midiData2,0,127); }
                break; }
            case SeqActionType::DMX:
                ImGui::Text("CH:"); ImGui::SameLine();
                ImGui::SetNextItemWidth(55); ImGui::InputInt(("##dch"+std::to_string(i)).c_str(),&a.dmxChannel); a.dmxChannel=SafeClamp(a.dmxChannel,1,512); ImGui::SameLine();
                ImGui::SetNextItemWidth(120); ImGui::SliderFloat(("##dval"+std::to_string(i)).c_str(),&a.dmxValue,0.0f,1.0f,"%.2f");
                break;
            case SeqActionType::Serial: {
                const char* targets[]={"LED Strip","MultiVox"};
                ImGui::SetNextItemWidth(90); ImGui::Combo(("##starget"+std::to_string(i)).c_str(),&a.serialTarget,targets,2); ImGui::SameLine();
                ImGui::SetNextItemWidth(200); ImGui::InputText(("##scmd"+std::to_string(i)).c_str(),a.serialCommand,sizeof(a.serialCommand));
                break; }
            }
            ImGui::TableNextColumn();
            if (ImGui::Button(("X##"+std::to_string(i)).c_str())) toDelete.push_back(i);
        }
        for (auto it=toDelete.rbegin();it!=toDelete.rend();++it) seq.actions.erase(seq.actions.begin()+*it);
        ImGui::EndTable();
    }
    ImGui::EndChild();
}

void DrawAudioAnalysisTab() {
    ImGui::Text("Real-Time Audio Analysis - Works with Spotify, YouTube, Any Audio :)!");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (g_audioState.capturing) {
        ImGui::TextColored(ImVec4(0,1,0,1), "[LISTENING] System Audio Active");
        if (ImGui::Button("Stop Audio Capture")) StopAudioCapture();
    } else {
        ImGui::TextColored(ImVec4(1,0,0,1), "[STOPPED] Not Listening");
        if (ImGui::Button("Start Audio Capture")) StartAudioCapture();
    }
    ImGui::SameLine(); ImGui::TextDisabled("(Captures ALL system audio - Spotify, YouTube, etc.)");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (g_audioAnalyzer) {
        AudioBands bands = g_audioAnalyzer->GetBands();
        ImGui::Text("LIVE AUDIO BANDS:");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::Columns(2, "bandcols", false);
        ImGui::TextColored(ImVec4(0.5f,0.3f,1,1), "SUB (20-80Hz):");   ImGui::ProgressBar(bands.sub,    ImVec2(-1,22));
        ImGui::TextColored(ImVec4(1,0.3f,0.3f,1), "KICK (60-130Hz):"); ImGui::ProgressBar(bands.kick,   ImVec2(-1,22));
        ImGui::TextColored(ImVec4(1,0.6f,0.2f,1), "SNARE (150-500Hz):"); ImGui::ProgressBar(bands.snare, ImVec2(-1,22));
        ImGui::NextColumn();
        ImGui::TextColored(ImVec4(0.3f,1,0.3f,1), "MIDRANGE (500-3kHz):"); ImGui::ProgressBar(bands.midrange, ImVec2(-1,22));
        ImGui::TextColored(ImVec4(0.3f,0.8f,1,1), "PRESENCE (3-8kHz):"); ImGui::ProgressBar(bands.presence, ImVec2(-1,22));
        ImGui::TextColored(ImVec4(0.7f,0.7f,1,1), "AIR (8-18kHz):"); ImGui::ProgressBar(bands.air, ImVec2(-1,22));
        ImGui::Columns(1);
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::Text("Onset pulses:");
        ImGui::SameLine(); ImGui::TextColored(ImVec4(1,0.3f,0.3f,1),"KICK"); ImGui::SameLine(); ImGui::ProgressBar(bands.kickOnset, ImVec2(120,16));
        ImGui::SameLine(0,20); ImGui::TextColored(ImVec4(1,0.6f,0.2f,1),"SNARE"); ImGui::SameLine(); ImGui::ProgressBar(bands.snareOnset, ImVec2(120,16));
        ImGui::SameLine(0,20); ImGui::TextColored(ImVec4(0.3f,1,0.3f,1),"MID ATK"); ImGui::SameLine(); ImGui::ProgressBar(bands.midOnset, ImVec2(120,16));
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

        static float smoothing = 0.85f;
        if (ImGui::SliderFloat("Smoothing", &smoothing, 0.0f, 0.99f)) g_audioAnalyzer->SetSmoothing(smoothing);
        ImGui::SameLine(); ImGui::TextDisabled("(Higher = smoother)");
        if (ImGui::Button("Reset Calibration")) g_audioAnalyzer->ResetPeaks();
        ImGui::SameLine(); ImGui::TextDisabled("(Click if a band is stuck at max)");
    }

    if (g_audioAnalyzer) {
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextColored(ImVec4(1,1,0,1), "Per-Band Smoothing");
        ImGui::TextDisabled("Higher = smoother, lower = snappier");
        const char* bandNames[] = { "SUB","KICK","SNARE","MIDRANGE","PRESENCE","AIR" };
        auto* bandArr = g_audioAnalyzer->GetBandArray();
        ImGui::Columns(2, "smoothcols", false);
        for (int i = 0; i < 6; i++) {
            ImGui::SetNextItemWidth(180);
            char lbl[32]; snprintf(lbl, 32, "%s##sm%d", bandNames[i], i);
            ImGui::SliderFloat(lbl, &bandArr[i].smoothing, 0.0f, 0.99f, "%.2f");
            if (i == 2) ImGui::NextColumn();
        }
        ImGui::Columns(1);
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(0.5f,1,0.8f,1), "LFO / Metronome Channels"); ImGui::SameLine();
    if (ImGui::Button("+ Add LFO")) {
        LFOChannel lfo; snprintf(lfo.name,32,"LFO %d",(int)g_lfoChannels.size()+1); snprintf(lfo.oscAddress,128,"/lfo/%d",(int)g_lfoChannels.size()+1);
        g_lfoChannels.push_back(lfo);
    }
    ImGui::TextDisabled("Shape | Hz | Amp | live out | OSC routing per channel");
    {
        const char* shapeNames[] = { "Sine","Square","Saw","Triangle","Noise","Custom" };
        for (int i = 0; i < (int)g_lfoChannels.size(); i++) {
            auto& lfo = g_lfoChannels[i];
            ImGui::PushID(i);
            ImGui::Checkbox("##en",&lfo.enabled); ImGui::SameLine();
            ImGui::SetNextItemWidth(80); ImGui::InputText("##nm",lfo.name,32); ImGui::SameLine();
            int sh=(int)lfo.shape; ImGui::SetNextItemWidth(80);
            if (ImGui::Combo("##sh",&sh,shapeNames,6)) lfo.shape=(LFOShape)sh;
            ImGui::SameLine();
            ImGui::SetNextItemWidth(60); ImGui::DragFloat("Hz##r",&lfo.rateHz,0.01f,0.01f,50.0f,"%.2f"); ImGui::SameLine();
            ImGui::Checkbox("BPM##bs",&lfo.bpmSync);
            if (lfo.bpmSync) {
                ImGui::SameLine(); ImGui::SetNextItemWidth(55); ImGui::DragFloat("BPM##mb",&lfo.manualBPM,0.5f,20.0f,300.0f,"%.0f");
                ImGui::SameLine(); ImGui::SetNextItemWidth(50); ImGui::DragFloat("x##bm",&lfo.bpmMult,0.05f,0.125f,4.0f,"%.2f");
            }
            ImGui::SameLine(); ImGui::SetNextItemWidth(55); ImGui::DragFloat("Amp##a",&lfo.amplitude,0.01f,0.0f,1.0f,"%.2f");
            ImGui::SameLine(); ImGui::ProgressBar(lfo.value, ImVec2(70,0));
            ImGui::Indent(16.0f);
            ImGui::Checkbox("OSC##oe",&lfo.oscEnabled); ImGui::SameLine();
            ImGui::SetNextItemWidth(130); ImGui::InputText("Addr##oa",lfo.oscAddress,128); ImGui::SameLine();
            ImGui::SetNextItemWidth(95);  ImGui::InputText("IP##oi",lfo.oscIP,64); ImGui::SameLine();
            ImGui::SetNextItemWidth(80);  ImGui::InputInt("Port##op",&lfo.oscPort); ImGui::SameLine();
            ImGui::SetNextItemWidth(50);  ImGui::DragFloat("x##om",&lfo.multiplier,0.01f,0.1f,10.0f,"%.2f"); ImGui::SameLine();
            if (ImGui::Button("Del##d")) { g_lfoChannels.erase(g_lfoChannels.begin()+i); ImGui::Unindent(16.0f); ImGui::PopID(); break; }
            if (lfo.shape == LFOShape::Custom) {
                ImGui::Indent(16.0f);
                ImGui::Checkbox("Show Step Editor##se",&lfo.showEditor); ImGui::SameLine();
                ImGui::SetNextItemWidth(60); ImGui::SliderInt("Steps##sc",&lfo.customStepCount,2,16);
                if (lfo.showEditor) {
                    int curStep=(int)(lfo.phase*lfo.customStepCount)%lfo.customStepCount;
                    ImGui::Text("Steps, drag to set level, 0 = skipped:");
                    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(3,2));
                    for (int s=0;s<lfo.customStepCount;s++) {
                        ImGui::PushID(s);
                        if (lfo.customSteps[s]<=0.0f) lfo.stepEnabled[s]=false; else lfo.stepEnabled[s]=true;
                        bool isCur=(s==curStep); bool isOn=lfo.stepEnabled[s];
                        ImGui::BeginGroup();
                        ImVec4 col=isOn?(isCur?ImVec4(0.3f,0.9f,0.3f,0.6f):ImVec4(0.2f,0.4f,0.8f,0.5f)):ImVec4(0.4f,0.05f,0.05f,0.5f);
                        ImGui::PushStyleColor(ImGuiCol_FrameBg,col); ImGui::PushStyleColor(ImGuiCol_FrameBgActive,col);
                        ImGui::VSliderFloat("##vs",ImVec2(22,70),&lfo.customSteps[s],0.0f,1.0f,"");
                        ImGui::PopStyleColor(2); ImGui::EndGroup();
                        if (s<lfo.customStepCount-1) ImGui::SameLine(0,3);
                        ImGui::PopID();
                    }
                    ImGui::PopStyleVar();
                    ImGui::SameLine(0,12); ImGui::BeginGroup();
                    if (ImGui::SmallButton("All On"))   { for(int s=0;s<16;s++){lfo.customSteps[s]=1.0f; lfo.stepEnabled[s]=true;} }
                    if (ImGui::SmallButton("All Off"))  { for(int s=0;s<16;s++){lfo.customSteps[s]=0.0f; lfo.stepEnabled[s]=true;} }
                    if (ImGui::SmallButton("Ramp"))     { for(int s=0;s<16;s++){lfo.customSteps[s]=(float)s/15.0f; lfo.stepEnabled[s]=true;} }
                    if (ImGui::SmallButton("Beat 4/4")) { for(int s=0;s<16;s++){lfo.customSteps[s]=0.0f;lfo.stepEnabled[s]=true;} lfo.customSteps[0]=1.0f;lfo.customSteps[4]=0.7f;lfo.customSteps[8]=1.0f;lfo.customSteps[12]=0.7f; }
                    if (ImGui::SmallButton("Snare 2&4")){ for(int s=0;s<16;s++){lfo.customSteps[s]=0.0f;lfo.stepEnabled[s]=false;} lfo.stepEnabled[4]=true;lfo.stepEnabled[12]=true;lfo.customSteps[4]=1.0f;lfo.customSteps[12]=1.0f; }
                    if (ImGui::SmallButton("Skip Even")) { for(int s=0;s<16;s++) lfo.customSteps[s]=(s%2==0)?lfo.customSteps[s]:0.0f; }
                    ImGui::EndGroup();
                }
                ImGui::Unindent(16.0f);
            }
            ImGui::Unindent(16.0f);
            ImGui::PopID();
        }
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(1,0.8f,0.3f,1), "Manual Pulse Channels"); ImGui::SameLine();
    if (ImGui::Button("+ Add Pulse")) {
        PulseChannel p; snprintf(p.name,32,"Pulse %d",(int)g_pulseChannels.size()+1); snprintf(p.oscAddress,128,"/pulse/%d",(int)g_pulseChannels.size()+1);
        g_pulseChannels.push_back(p);
    }
    ImGui::TextDisabled("Fire manually: decays at set rate, send to OSC");
    for (int i=0;i<(int)g_pulseChannels.size();i++) {
        auto& p=g_pulseChannels[i];
        ImGui::PushID(1000+i);
        ImGui::Checkbox("##en",&p.enabled); ImGui::SameLine();
        ImGui::SetNextItemWidth(80); ImGui::InputText("##nm",p.name,32); ImGui::SameLine();
        ImGui::SetNextItemWidth(70); ImGui::DragFloat("Decay##dc",&p.decay,0.005f,0.5f,0.999f,"%.3f"); ImGui::SameLine();
        if (ImGui::Button("  FIRE  ")) p.Fire(); ImGui::SameLine(); ImGui::ProgressBar(p.value,ImVec2(70,0));
        ImGui::Indent(16.0f);
        ImGui::Checkbox("OSC##oe",&p.oscEnabled); ImGui::SameLine();
        ImGui::SetNextItemWidth(130); ImGui::InputText("Addr##oa",p.oscAddress,128); ImGui::SameLine();
        ImGui::SetNextItemWidth(95);  ImGui::InputText("IP##oi",p.oscIP,64); ImGui::SameLine();
        ImGui::SetNextItemWidth(80);  ImGui::InputInt("Port##op",&p.oscPort); ImGui::SameLine();
        ImGui::SetNextItemWidth(50);  ImGui::DragFloat("x##om",&p.multiplier,0.01f,0.1f,10.0f,"%.2f"); ImGui::SameLine();
        if (ImGui::Button("Del##d")) { g_pulseChannels.erase(g_pulseChannels.begin()+i); ImGui::Unindent(16.0f); ImGui::PopID(); break; }
        ImGui::Unindent(16.0f); ImGui::PopID();
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(1,1,0,1), "Audio Band Routing - Map Bands to OSC Addresses");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    static char newMappingName[64] = "My Parameter";
    static char newOscAddr[128] = "/audio/param1";
    static char newIP[64] = "127.0.0.1";
    static int  newBandType = 0;
    static int  newPort = 8000;

    ImGui::Text("Add New Mapping:");
    ImGui::InputText("Name", newMappingName, sizeof(newMappingName)); ImGui::SameLine();
    const char* bandTypes[] = {
        "LOW (legacy)","MID (legacy)","HIGH (legacy)","OVERALL",
        "SUB (20-80Hz)","KICK (60-130Hz)","SNARE (150-500Hz)",
        "MIDRANGE (500-3kHz)","PRESENCE (3-8kHz)","AIR (8-18kHz)",
        "KICK onset","SNARE onset","MID onset",
        "LFO 1","LFO 2","LFO 3","LFO 4",
        "Pulse 1","Pulse 2","Pulse 3","Pulse 4"
    };
    ImGui::Combo("Band", &newBandType, bandTypes, 21);
    ImGui::InputText("OSC Address", newOscAddr, sizeof(newOscAddr));
    ImGui::InputText("IP", newIP, sizeof(newIP)); ImGui::SameLine();
    ImGui::InputInt("Port", &newPort); ImGui::SameLine();
    if (ImGui::Button("Add Mapping")) {
        AudioBandMapping mapping;
        mapping.displayName=newMappingName; mapping.oscAddress=newOscAddr; mapping.ip=newIP;
        mapping.bandType=newBandType; mapping.enabled=true; mapping.multiplier=1.0f; mapping.port=newPort;
        g_audioBandMappings.push_back(mapping);
        std::string addr=newOscAddr;
        size_t p=addr.find_last_of("0123456789");
        if (p!=std::string::npos) { addr=addr.substr(0,p)+std::to_string(std::stoi(addr.substr(p))+1); strcpy_s(newOscAddr,addr.c_str()); }
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    if (ImGui::Button("Unreal: Brightness (Low)")) { AudioBandMapping m; m.displayName="Unreal Brightness"; m.oscAddress="/unreal/brightness"; m.ip="127.0.0.1"; m.bandType=0; m.enabled=true; m.port=8000; g_audioBandMappings.push_back(m); } ImGui::SameLine();
    if (ImGui::Button("TouchDesigner: Intensity (Mid)")) { AudioBandMapping m; m.displayName="TD Intensity"; m.oscAddress="/td/intensity"; m.ip="127.0.0.1"; m.bandType=1; m.enabled=true; m.port=7000; g_audioBandMappings.push_back(m); } ImGui::SameLine();
    if (ImGui::Button("RaspberryPi: Color (High)")) { AudioBandMapping m; m.displayName="RPi Color"; m.oscAddress="/raspberrypi/color"; m.ip="192.168.1.100"; m.bandType=2; m.enabled=true; m.port=5000; g_audioBandMappings.push_back(m); }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("Current Audio Band Mappings (%d total):", (int)g_audioBandMappings.size()); ImGui::SameLine();
    if (ImGui::Button("+ Add")) {
        AudioBandMapping mapping; mapping.displayName="New Band"; mapping.oscAddress="/audio/band";
        mapping.ip="127.0.0.1"; mapping.bandType=4; mapping.enabled=true; mapping.multiplier=1.0f; mapping.port=8000;
        g_audioBandMappings.push_back(mapping);
    }

    if (ImGui::BeginTable("AudioMappingsTable", 8, ImGuiTableFlags_Resizable|ImGuiTableFlags_Borders|ImGuiTableFlags_RowBg|ImGuiTableFlags_ScrollY, ImVec2(0,300))) {
        ImGui::TableSetupColumn("Enabled",     ImGuiTableColumnFlags_WidthFixed, 60);
        ImGui::TableSetupColumn("Name",        ImGuiTableColumnFlags_WidthFixed, 150);
        ImGui::TableSetupColumn("Band",        ImGuiTableColumnFlags_WidthFixed, 120);
        ImGui::TableSetupColumn("OSC Address", ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("IP",          ImGuiTableColumnFlags_WidthFixed, 120);
        ImGui::TableSetupColumn("Port",        ImGuiTableColumnFlags_WidthFixed, 80);
        ImGui::TableSetupColumn("Multiplier",  ImGuiTableColumnFlags_WidthFixed, 100);
        ImGui::TableSetupColumn("Actions",     ImGuiTableColumnFlags_WidthFixed, 80);
        ImGui::TableHeadersRow();

        std::vector<int> toDelete;
        const char* bandTypes2[] = { "LOW","MID","HIGH","OVERALL","SUB","KICK","SNARE","MIDRANGE","PRESENCE","AIR","KICK onset","SNARE onset","MID onset","LFO 1","LFO 2","LFO 3","LFO 4","Pulse 1","Pulse 2","Pulse 3","Pulse 4" };
        for (int i=0;i<(int)g_audioBandMappings.size();i++) {
            auto& m=g_audioBandMappings[i];
            ImGui::TableNextRow();
            ImGui::TableNextColumn(); ImGui::Checkbox(("##en"+std::to_string(i)).c_str(),&m.enabled);
            ImGui::TableNextColumn(); char nb[64]; strcpy_s(nb,m.displayName.c_str()); ImGui::SetNextItemWidth(-1); if(ImGui::InputText(("##nm"+std::to_string(i)).c_str(),nb,sizeof(nb))) m.displayName=nb;
            ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::Combo(("##bd"+std::to_string(i)).c_str(),&m.bandType,bandTypes2,21);
            ImGui::TableNextColumn(); char ab[128]; strcpy_s(ab,m.oscAddress.c_str()); ImGui::SetNextItemWidth(-1); if(ImGui::InputText(("##ad"+std::to_string(i)).c_str(),ab,sizeof(ab))) m.oscAddress=ab;
            ImGui::TableNextColumn(); char ib[64]; strcpy_s(ib,m.ip.c_str()); ImGui::SetNextItemWidth(-1); if(ImGui::InputText(("##ip"+std::to_string(i)).c_str(),ib,sizeof(ib))) m.ip=ib;
            ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::InputInt(("##pt"+std::to_string(i)).c_str(),&m.port);
            ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::DragFloat(("##ml"+std::to_string(i)).c_str(),&m.multiplier,0.05f,0.1f,10.f,"%.2fx");
            ImGui::TableNextColumn(); if(ImGui::Button(("Delete##"+std::to_string(i)).c_str())) toDelete.push_back(i);
        }
        for (auto it=toDelete.rbegin();it!=toDelete.rend();++it) g_audioBandMappings.erase(g_audioBandMappings.begin()+*it);
        ImGui::EndTable();
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(0,1,1,1), "How to Use:");
    ImGui::BulletText("1. Start Audio Capture above");
    ImGui::BulletText("2. Go to 'OSC Destinations' tab and add your apps");
    ImGui::BulletText("3. Add mappings to control specific parameters");
    ImGui::BulletText("4. Each mapping sends its chosen band to the OSC address");
    ImGui::BulletText("5. All enabled destinations receive these messages automatically!");
}

void DrawMultimediaTab() {
    PushSubTabStyle();
    if (ImGui::BeginTabBar("MultimediaSubTabs")) {
        if (ImGui::BeginTabItem("LED Strip"))       { DrawMultimedia_LEDStripSubTab();       ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("After Effects"))   { DrawMultimedia_AfterEffectsSubTab();   ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("Timed Sequences")) { DrawMultimedia_TimedSequencesSubTab(); ImGui::EndTabItem(); }
        ImGui::EndTabBar();
    }
    PopSubTabStyle();
}
