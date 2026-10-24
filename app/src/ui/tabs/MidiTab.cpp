#include "src/ui/tabs/UICommon.h"
#include "src/midi/WinMidi.h"

void DrawOSCDestinationsTab() {
    ImGui::Text("OSC Destinations - Send to Multiple Applications Simultaneously");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    static char newName[64] = "";
    static char newIP[64] = "127.0.0.1";
    static int newPort = 8000;

    ImGui::Text("Add New Destination:");
    ImGui::InputText("Name", newName, sizeof(newName));
    ImGui::SameLine();
    ImGui::InputText("IP", newIP, sizeof(newIP));
    ImGui::SameLine();
    ImGui::InputInt("Port", &newPort);

    if (ImGui::Button("Add Destination")) {
        if (strlen(newName) > 0) {
            AddOSCDestination(newName, newIP, newPort);
            strcpy_s(newName, "");
            newPort++;
        }
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    ImGui::Text("Quick Add from Presets:");
    int buttonsPerRow = 4;
    int count = 0;
    for (const auto& pair : g_presets) {
        if (ImGui::Button(pair.second.name.c_str(), ImVec2(140, 30)))
            AddOSCDestination(pair.second.name, pair.second.ip, pair.second.port);
        if (++count % buttonsPerRow != 0) ImGui::SameLine();
    }
    ImGui::NewLine();

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("Current Destinations (%d total):", (int)g_oscDestinations.size());

    if (ImGui::BeginTable("DestinationsTable", 5, ImGuiTableFlags_Resizable | ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_ScrollY)) {
        ImGui::TableSetupColumn("Enabled", ImGuiTableColumnFlags_WidthFixed, 70.0f);
        ImGui::TableSetupColumn("Name",    ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("IP:Port", ImGuiTableColumnFlags_WidthFixed, 180.0f);
        ImGui::TableSetupColumn("Status",  ImGuiTableColumnFlags_WidthFixed, 100.0f);
        ImGui::TableSetupColumn("Actions", ImGuiTableColumnFlags_WidthFixed, 80.0f);
        ImGui::TableHeadersRow();

        for (size_t i = 0; i < g_oscDestinations.size(); i++) {
            auto& dest = g_oscDestinations[i];
            ImGui::TableNextRow();
            ImGui::TableNextColumn();
            if (ImGui::Checkbox(("##enabled" + std::to_string(i)).c_str(), &dest.enabled)) {
                if (dest.enabled) {
                    try {
                        dest.sender = std::make_unique<UdpTransmitSocket>(IpEndpointName(dest.ip.c_str(), dest.port));
                        dest.connected = true;
                    } catch (std::exception& e) {
                        dest.connected = false;
                        std::cout << "Failed to initialize OSC destination " << dest.name << ": " << e.what() << std::endl;
                    }
                }
            }
            ImGui::TableNextColumn();
            char nameBuffer[64]; strcpy_s(nameBuffer, dest.name.c_str());
            if (ImGui::InputText(("##name" + std::to_string(i)).c_str(), nameBuffer, sizeof(nameBuffer)))
                dest.name = nameBuffer;

            ImGui::TableNextColumn();
            char ipPortBuffer[128];
            sprintf_s(ipPortBuffer, "%s:%d", dest.ip.c_str(), dest.port);
            if (ImGui::InputText(("##ipport" + std::to_string(i)).c_str(), ipPortBuffer, sizeof(ipPortBuffer))) {
                std::string input = ipPortBuffer;
                size_t colonPos = input.find_last_of(':');
                if (colonPos != std::string::npos) {
                    dest.ip = input.substr(0, colonPos);
                    try {
                        dest.port = std::stoi(input.substr(colonPos + 1));
                        dest.sender = std::make_unique<UdpTransmitSocket>(IpEndpointName(dest.ip.c_str(), dest.port));
                        dest.connected = true;
                    }
                    catch (std::exception&) {
                        dest.connected = false;
                    }
                }
            }
            ImGui::TableNextColumn();
            if (dest.connected && dest.enabled)   ImGui::TextColored(ImVec4(0,1,0,1), "Connected");
            else if (!dest.enabled)                ImGui::TextColored(ImVec4(0.7f,0.7f,0.7f,1), "Disabled");
            else                                   ImGui::TextColored(ImVec4(1,0,0,1), "Error");

            ImGui::TableNextColumn();
            if (ImGui::Button(("Remove##" + std::to_string(i)).c_str())) {
                RemoveOSCDestination(i);
                break;
            }
        }
        ImGui::EndTable();
    }

    ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(0,1,1,1), "How Multi-Destination Works:");
    ImGui::BulletText("Each destination can use different ports (no conflicts!)");
    ImGui::BulletText("All MIDI controls send to all enabled destinations simultaneously");
    ImGui::BulletText("Same mappings and addresses used for all destinations");
    ImGui::BulletText("Perfect for controlling Unreal + TouchDesigner + others at once");
    ImGui::BulletText("Enable/disable destinations individually as needed");
    ImGui::BulletText("Original single destination still works for backward compatibility");
}

void DrawGuitarMIDITab() {
    ImGui::Text("Real-Time Guitar to MIDI Conversion");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (ImGui::Checkbox("Enable Guitar MIDI", &g_guitarState.enabled)) {
        if (g_guitarState.enabled && !g_guitarSystem) {
            g_guitarSystem = new SimpleGuitarSystem();
            g_guitarSystem->SetMidiOut(g_midiOut.get());
        }
    }
    ImGui::SameLine(); ImGui::TextDisabled("(Requires Audio Capture + MIDI Out)");

    if (!g_audioState.capturing)
        ImGui::TextColored(ImVec4(1.0f, 0.5f, 0.0f, 1.0f), "WARNING: Audio Capture is OFF - Enable in Audio Analysis tab!");
    if (!g_midiOutConnected)
        ImGui::TextColored(ImVec4(1.0f, 0.5f, 0.0f, 1.0f), "WARNING: MIDI Output not connected - Select device in Dashboard!");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (g_guitarState.enabled && g_guitarSystem) {
        int activeNotes = g_guitarSystem->GetActiveNoteCount();
        if (activeNotes > 0)
            ImGui::TextColored(ImVec4(0,1,0,1), "PLAYING - %d note%s detected", activeNotes, activeNotes == 1 ? "" : "s");
        else
            ImGui::TextColored(ImVec4(0.7f,0.7f,0.7f,1), "Ready - Play your guitar!");
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (g_audioState.capturing) {
        static float displayLevel = 0.0f;
        if (g_audioAnalyzer) {
            AudioBands bands = g_audioAnalyzer->GetBands();
            float currentLevel = (bands.low + bands.mid + bands.high) / 3.0f;
            displayLevel = displayLevel * 0.8f + currentLevel * 0.2f;
        }
        ImGui::Text("Guitar Input Level:");
        ImGui::PushID("guitar_input_level");
        ImGui::ProgressBar(displayLevel, ImVec2(-1, 20));
        ImGui::PopID();

        if (g_guitarState.enabled && g_guitarSystem && g_guitarSystem->GetActiveNoteCount() > 0)
            ImGui::TextColored(ImVec4(0,1,0,1), "DETECTING: Note active!");

        if (displayLevel < 0.05f)
            ImGui::TextColored(ImVec4(1,0.5f,0,1), "WARNING: Input level very low - increase Input Gain slider above!");
        else
            ImGui::TextColored(ImVec4(0,1,0,1), "Input level: GOOD - ready to detect notes");
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("Detection Mode:");
    if (ImGui::RadioButton("Monophonic (Single Notes)", !g_guitarState.polyphonic)) {
        g_guitarState.polyphonic = false;
        if (g_guitarSystem) g_guitarSystem->SetPolyphonic(false);
    }
    ImGui::SameLine(); ImGui::TextDisabled("(Best for solos, leads - 95-98%% accuracy)");
    if (ImGui::RadioButton("Polyphonic (Chords)", g_guitarState.polyphonic)) {
        g_guitarState.polyphonic = true;
        if (g_guitarSystem) g_guitarSystem->SetPolyphonic(true);
    }
    ImGui::SameLine(); ImGui::TextDisabled("(Detects full chords - 85-90%% accuracy)");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("Input Settings:");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::SliderFloat("Input Gain", &g_guitarState.inputGain, 1.0f, 20.0f, "%.1fx");
    ImGui::SameLine(); ImGui::TextDisabled("(Boost weak guitar signals - start at 8-10x)");
    ImGui::SliderFloat("Noise Gate", &g_guitarState.noiseGate, 0.0f, 0.01f, "%.4f");
    ImGui::SameLine(); ImGui::TextDisabled("(Kills background noise - increase if too sensitive)");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Text("MIDI Settings:");
    if (ImGui::SliderInt("MIDI Channel", &g_guitarState.midiChannel, 1, 16))
        if (g_guitarSystem) g_guitarSystem->SetMidiChannel(g_guitarState.midiChannel);
    if (ImGui::SliderInt("Velocity", &g_guitarState.velocity, 1, 127))
        if (g_guitarSystem) g_guitarSystem->SetVelocity(g_guitarState.velocity);
    ImGui::SameLine(); ImGui::TextDisabled("(Base velocity for detected notes)");
    if (ImGui::SliderFloat("Sensitivity", &g_guitarState.sensitivity, 0.0f, 1.0f, "%.2f"))
        if (g_guitarSystem) g_guitarSystem->SetSensitivity(g_guitarState.sensitivity);
    ImGui::SameLine(); ImGui::TextDisabled("(Higher = more sensitive to quiet notes)");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    if (ImGui::CollapsingHeader("Advanced Options")) {
        if (!g_guitarState.polyphonic) {
            if (ImGui::Checkbox("Pitch Bend (Monophonic)", &g_guitarState.pitchBend))
                if (g_guitarSystem) g_guitarSystem->SetPitchBend(g_guitarState.pitchBend);
            ImGui::SameLine(); ImGui::TextDisabled("(Fine-tune pitch with MIDI pitch bend)");
        }
        ImGui::Checkbox("Send to OSC Destinations", &g_guitarState.sendToOSC);
        ImGui::SameLine(); ImGui::TextDisabled("(Route MIDI notes to all OSC apps)");
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    if (ImGui::CollapsingHeader("How to Use")) {
        ImGui::TextColored(ImVec4(0,1,1,1), "Setup Steps:");
        ImGui::BulletText("1. Enable Audio Capture (Audio Analysis tab)");
        ImGui::BulletText("2. Select MIDI Output device (Dashboard tab)");
        ImGui::BulletText("3. Check 'Enable Guitar MIDI' above");
        ImGui::BulletText("4. Choose Monophonic or Polyphonic mode");
        ImGui::BulletText("5. Adjust sensitivity if needed");
        ImGui::BulletText("6. Play your guitar!");
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(1,1,0,1), "Troubleshooting:");
        ImGui::BulletText("Select your guitar interface, NOT 'System Default'");
        ImGui::BulletText("Turn up guitar volume AND interface input gain");
        ImGui::BulletText("Use BRIDGE pickup for clearest tracking");
        ImGui::BulletText("Play single notes cleanly in Monophonic mode");
    }

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    if (ImGui::CollapsingHeader("Technical Details")) {
        ImGui::Text("Monophonic Algorithm: YIN (autocorrelation-based)");
        ImGui::Text("Polyphonic Algorithm: FFT + Harmonic Product Spectrum");
        ImGui::Text("Latency: ~15ms");
        ImGui::Text("Guitar Range: E2 (82Hz) to E6 (1318Hz)");
        ImGui::Text("Sample Rate: 48kHz");
        ImGui::Text("Buffer Size: 4096 samples");
    }
}

void DrawApplicationMenuBar() {
    if (ImGui::BeginMenuBar()) {
        if (ImGui::BeginMenu("File")) {
            if (ImGui::MenuItem("New Config")) {
                g_controlMappings.clear();
                g_oscDestinations.clear();
                g_config = Config();
            }
            if (ImGui::MenuItem("Save Config")) SaveConfig();
            if (ImGui::MenuItem("Load Config")) LoadConfig();
            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
            if (ImGui::MenuItem("Switch to the new interface")) SwitchToNewInterface();
            if (ImGui::MenuItem("Exit")) g_running = false;
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Presets")) {
            for (const auto& pair : g_presets) {
                bool selected = (g_currentPresetIndex == pair.first);
                if (ImGui::MenuItem(pair.second.name.c_str(), nullptr, selected))
                    LoadPreset(pair.first);
            }
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Options")) {
            ImGui::SliderFloat("UI Scale", &g_config.uiScale, 0.5f, 2.0f);
            if (ImGui::IsItemDeactivatedAfterEdit()) ApplyColorTheme();
            const char* themes[] = { "Dark", "Light", "Custom" };
            if (ImGui::Combo("Theme", &g_config.colorTheme, themes, 3)) ApplyColorTheme();
            if (g_config.colorTheme == 2) {
                ImGui::Text("Primary Color (Hex):");
                if (ImGui::InputText("##CustomColor", g_config.customColorHex, sizeof(g_config.customColorHex))) ApplyColorTheme();
                ImGui::SameLine(); ImGui::TextDisabled("(buttons, tabs, highlights)");
                ImGui::Text("Secondary Color (Hex):");
                if (ImGui::InputText("##CustomColor2", g_config.customColorHex2, sizeof(g_config.customColorHex2))) ApplyColorTheme();
                ImGui::SameLine(); ImGui::TextDisabled("(backgrounds)");
                ImGui::Text("Sub-tab Color (Hex):");
                if (ImGui::InputText("##CustomColor3", g_config.customColorHex3, sizeof(g_config.customColorHex3))) ApplyColorTheme();
                ImGui::SameLine(); ImGui::TextDisabled("(sub-tabs)");
                ImGui::Text("Frame/Box Color (Hex):");
                if (ImGui::InputText("##CustomColor4", g_config.customColorHex4, sizeof(g_config.customColorHex4))) ApplyColorTheme();
                ImGui::SameLine(); ImGui::TextDisabled("(input boxes, frames)");
            }
            ImGui::EndMenu();
        }
        if (ImGui::MenuItem("Accessibility")) g_showAccessibilityPopup = true;
        if (ImGui::BeginMenu("Help")) {
            if (ImGui::MenuItem("About & Tutorial"))   g_showAboutPopup = true;
            if (ImGui::MenuItem("Preset Setup Guide")) g_showPresetGuidePopup = true;
            ImGui::EndMenu();
        }
        ImGui::EndMenuBar();
    }
}

void DrawDashboardTab() {
    ImGui::Text("Device Status & Configuration");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.3f, 0.3f, 0.0f, 0.3f));
    if (ImGui::BeginChild("LiveKeyDetector", ImVec2(0, 130), true)) {
        ImGui::TextColored(ImVec4(1,1,0,1), "Live Note Detector");
        ImGui::Spacing();
        if (ImGui::BeginTable("LiveNoteTable", 4, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_SizingStretchProp)) {
            ImGui::TableSetupColumn("Note",     ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Channel",  ImGuiTableColumnFlags_WidthFixed, 70.f);
            ImGui::TableSetupColumn("Velocity", ImGuiTableColumnFlags_WidthFixed, 70.f);
            ImGui::TableSetupColumn("Status",   ImGuiTableColumnFlags_WidthFixed, 70.f);
            ImGui::TableHeadersRow();
            std::lock_guard<std::mutex> lock(g_notesMutex);
            if (g_activeNotes.empty()) {
                ImGui::TableNextRow();
                ImGui::TableNextColumn(); ImGui::TextDisabled("No active notes");
                ImGui::TableNextColumn(); ImGui::TableNextColumn(); ImGui::TableNextColumn();
            } else {
                for (int note : g_activeNotes) {
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn(); ImGui::TextColored(ImVec4(1,1,0,1), "%s", MidiNoteToName(note).c_str());
                    ImGui::TableNextColumn(); ImGui::Text("--");
                    ImGui::TableNextColumn(); ImGui::Text("--");
                    ImGui::TableNextColumn(); ImGui::TextColored(ImVec4(0,1,0,1), "ACTIVE");
                }
            }
            ImGui::EndTable();
        }
        auto now = std::chrono::steady_clock::now();
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - g_lastMidiActivity).count();
        ImGui::Spacing();
        if (ms < 1000) ImGui::TextColored(ImVec4(0,1,0,1), "MIDI Activity: ACTIVE");
        else           ImGui::TextColored(ImVec4(0.7f,0.7f,0.7f,1), "MIDI Activity: Idle (%d ms ago)", (int)ms);
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::Spacing();

    ImGui::Text("MIDI Backend");
    int backendIndex = (int)g_currentMidiBackend;
    if (ImGui::Combo("##MidiBackend", &backendIndex, g_midiBackendNames, IM_ARRAYSIZE(g_midiBackendNames)))
        SwitchMidiBackend((MidiBackend)backendIndex);
    ImGui::SameLine(); ImGui::TextDisabled("(Switch MIDI driver)");

    ImGui::Spacing();
    ImGui::Text("MIDI Devices");
    ImGui::Checkbox("Auto-Connect MIDI", &g_config.autoConnectMIDI);
    ImGui::SameLine(); ImGui::TextDisabled("(Automatically connects to first available device)");

    static std::vector<std::string> midiInNames;
    if (ImGui::Button("Refresh Devices") || midiInNames.empty()) {
        midiInNames = GetMidiInDeviceNames();
        AutoConnectMIDI();
    }

    ImGui::Text("MIDI Input:");
    if (ImGui::BeginCombo("##MIDIIn", (g_config.midiInDevice >= 0 && g_config.midiInDevice < (int)midiInNames.size()) ? midiInNames[g_config.midiInDevice].c_str() : "Select device...")) {
        for (int i = 0; i < (int)midiInNames.size(); i++) {
            bool selected = (g_config.midiInDevice == i);
            if (ImGui::Selectable(midiInNames[i].c_str(), selected)) { g_config.midiInDevice = i; OpenMidiInput(i); }
            if (selected) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }

    static std::vector<std::string> midiOutNames;
    if (midiOutNames.empty()) midiOutNames = GetMidiOutDeviceNames();

    ImGui::Text("MIDI Output:");
    if (ImGui::BeginCombo("##MIDIOut", (g_config.midiOutDevice >= 0 && g_config.midiOutDevice < (int)midiOutNames.size()) ? midiOutNames[g_config.midiOutDevice].c_str() : "Select device...")) {
        for (int i = 0; i < (int)midiOutNames.size(); i++) {
            bool selected = (g_config.midiOutDevice == i);
            if (ImGui::Selectable(midiOutNames[i].c_str(), selected)) { g_config.midiOutDevice = i; OpenMidiOutput(i); }
            if (selected) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }

    ImGui::Spacing();
    ImGui::Text("OSC Configuration");
    if (ImGui::Button("Auto Local IP")) { std::string localIP = GetLocalIPAddress(); strcpy_s(g_config.oscIP, localIP.c_str()); }
    ImGui::SameLine(); ImGui::TextDisabled("(Automatically detect your IP)");
    ImGui::TextColored(ImVec4(0,1,1,1), "Use 'OSC' tab for multi-port support!");
    ImGui::InputText("OSC Address", g_config.oscAddress, sizeof(g_config.oscAddress));
    ImGui::InputText("Target IP", g_config.oscIP, sizeof(g_config.oscIP));
    ImGui::InputInt("Send Port", &g_config.oscSendPort);
    ImGui::SameLine(); ImGui::TextDisabled("(Primary destination port)");
    ImGui::InputInt("Listen Port", &g_config.oscListenPort);
    ImGui::SameLine(); ImGui::TextDisabled("(Port to receive OSC from target app)");

    if (!g_oscDestinations.empty()) {
        ImGui::Spacing(); ImGui::Text("Active OSC Destinations:");
        for (const auto& dest : g_oscDestinations) {
            if (dest.enabled) {
                if (dest.connected) ImGui::TextColored(ImVec4(0,1,0,1), "[OK] %s (%s:%d)", dest.name.c_str(), dest.ip.c_str(), dest.port);
                else                ImGui::TextColored(ImVec4(1,0,0,1), "[X] %s (%s:%d)",  dest.name.c_str(), dest.ip.c_str(), dest.port);
            } else {
                ImGui::TextColored(ImVec4(0.7f,0.7f,0.7f,1), "[-] %s (disabled)", dest.name.c_str());
            }
        }
    }

    ImGui::Spacing();
    ImGui::Text("Current Preset: %s", g_config.presetName);
    ImGui::Spacing();
    ImGui::Text("Connection Status:");
    if (g_midiInConnected)  ImGui::TextColored(ImVec4(0,1,0,1), "[OK] MIDI Input: Connected");
    else                    ImGui::TextColored(ImVec4(1,0,0,1), "[X] MIDI Input: Disconnected");
    if (g_midiOutConnected) ImGui::TextColored(ImVec4(0,1,0,1), "[OK] MIDI Output: Connected");
    else                    ImGui::TextColored(ImVec4(1,0,0,1), "[X] MIDI Output: Disconnected");
    if (g_oscState.senderReady) ImGui::TextColored(ImVec4(0,1,0,1), "[OK] OSC Sender: Ready");
    else                        ImGui::TextColored(ImVec4(1,0,0,1), "[X] OSC Sender: Not Ready");

    int connectedDestinations = 0;
    for (const auto& dest : g_oscDestinations) if (dest.enabled && dest.connected) connectedDestinations++;
    if (connectedDestinations > 0)
        ImGui::TextColored(ImVec4(0,1,0,1), "[OK] Additional Destinations: %d connected", connectedDestinations);
    ImGui::BulletText("Local IP: %s", GetLocalIPAddress().c_str());

    ImGui::Spacing();
    ImGui::Checkbox("Send to OSC", &g_config.sendToOSC); ImGui::SameLine(); ImGui::TextDisabled("(Converts MIDI to OSC messages)");
    ImGui::Checkbox("Send to MIDI", &g_config.sendToMIDI); ImGui::SameLine(); ImGui::TextDisabled("(Converts incoming OSC back to MIDI)");
    ImGui::Checkbox("Receive from OSC", &g_config.receiveFromOSC); ImGui::SameLine(); ImGui::TextDisabled("(Listen for OSC messages from applications)");
    ImGui::Checkbox("MIDI Thru", &g_config.midiThru); ImGui::SameLine(); ImGui::TextDisabled("(Pass MIDI input directly to MIDI output)");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(0,1,1,1), "Bridge ports (both directions)");
    ImGui::Spacing();

    static std::vector<std::string> s_outPortNames, s_inPortNames;
    static float s_lastPortScan = -999.f;
    float s_nowSec = (float)GetTickCount() / 1000.f;
    if (s_nowSec - s_lastPortScan > 2.f) {
        s_outPortNames.clear(); s_inPortNames.clear();
        { RtMidiOut tmp; for (unsigned i = 0; i < tmp.getPortCount(); i++) s_outPortNames.push_back(tmp.getPortName(i)); }
        { RtMidiIn  tmp; for (unsigned i = 0; i < tmp.getPortCount(); i++) s_inPortNames.push_back(tmp.getPortName(i)); }
        s_lastPortScan = s_nowSec;
    }

    ImGui::Text("OUT  (RICO mirrors to this port):");
    ImGui::SetNextItemWidth(320);
    if (ImGui::BeginCombo("##loopOut", (g_loopMidi.outPortIndex >= 0 && g_loopMidi.outPortIndex < (int)s_outPortNames.size()) ? s_outPortNames[g_loopMidi.outPortIndex].c_str() : "Pick an OUT port...")) {
        for (int i = 0; i < (int)s_outPortNames.size(); i++) {
            bool sel = (g_loopMidi.outPortIndex == i);
            if (ImGui::Selectable(s_outPortNames[i].c_str(), sel)) { g_loopMidi.outPortIndex = i; strncpy_s(g_loopMidi.outPortName, s_outPortNames[i].c_str(), sizeof(g_loopMidi.outPortName)); }
            if (sel) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }
    ImGui::SameLine();
    if (ImGui::Checkbox("Enable##outBridge", &g_loopMidi.outEnabled)) {
        if (g_loopMidi.outEnabled) InitLoopMidiBridge(g_loopMidi.outPortIndex);
        else if (g_loopMidi.out) { delete g_loopMidi.out; g_loopMidi.out = nullptr; }
    }
    ImGui::SameLine();
    if (g_loopMidi.out && g_loopMidi.out->isPortOpen()) ImGui::TextColored(ImVec4(0,1,0,1), "[OUT ACTIVE]");
    else                                               ImGui::TextColored(ImVec4(1,0.5f,0,1), "[OFF]");

    ImGui::Spacing();
    ImGui::Text("IN   (RICO receives from this port):");
    ImGui::SetNextItemWidth(320);
    if (ImGui::BeginCombo("##loopIn", (g_loopMidi.inPortIndex >= 0 && g_loopMidi.inPortIndex < (int)s_inPortNames.size()) ? s_inPortNames[g_loopMidi.inPortIndex].c_str() : "Pick an IN port...")) {
        for (int i = 0; i < (int)s_inPortNames.size(); i++) {
            bool sel = (g_loopMidi.inPortIndex == i);
            if (ImGui::Selectable(s_inPortNames[i].c_str(), sel)) { g_loopMidi.inPortIndex = i; strncpy_s(g_loopMidi.inPortName, s_inPortNames[i].c_str(), sizeof(g_loopMidi.inPortName)); }
            if (sel) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }
    ImGui::SameLine();
    if (ImGui::Checkbox("Enable##inBridge", &g_loopMidi.inEnabled)) {
        if (g_loopMidi.inEnabled) InitLoopMidiBridgeIn(g_loopMidi.inPortIndex);
        else if (g_loopMidi.in) { g_loopMidi.in->closePort(); delete g_loopMidi.in; g_loopMidi.in = nullptr; }
    }
    ImGui::SameLine();
    if (g_loopMidi.in && g_loopMidi.in->isPortOpen()) ImGui::TextColored(ImVec4(0,1,0,1), "[IN ACTIVE]");
    else                                             ImGui::TextColored(ImVec4(1,0.5f,0,1), "[OFF]");

    ImGui::TextDisabled("Tip: make two virtual ports below, one for OUT and one for IN.");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextColored(ImVec4(0,1,1,1), "VIRTUAL MIDI PORTS");
    ImGui::Spacing();
    ImGui::SetNextItemWidth(200);
    ImGui::InputText("##newportname", g_newVirtualPortName, sizeof(g_newVirtualPortName));
    ImGui::SameLine();
    if (ImGui::Button("+ Create Port", ImVec2(140, 28))) CreateNamedVirtualPort(g_newVirtualPortName);
    ImGui::TextDisabled("Made with Windows MIDI Services. Other apps see the port by its name.");
    if (!WinMidi_Ready() && strcmp(WinMidi_Status(), "Not started") != 0)
        ImGui::TextColored(ImVec4(1, 0.75f, 0.1f, 1), "%s", WinMidi_Status());
    ImGui::Spacing();
    for (int i = 0; i < (int)g_virtualPorts.size(); i++) {
        auto& p = g_virtualPorts[i];
        ImGui::TextColored(ImVec4(0,1,0,1), "[ACTIVE]"); ImGui::SameLine();
        ImGui::Text("\"%s\"", p.name); ImGui::SameLine();
        if (ImGui::Button(("Destroy##" + std::to_string(i)).c_str(), ImVec2(80, 22))) DestroyVirtualPort(i);
    }
    if (g_virtualPorts.empty()) ImGui::TextDisabled("No virtual ports active.");
}

void DrawMappingsTab() {
    ImGui::Text("Control Mappings - Auto-detected with Data Types");

    float windowHeight = ImGui::GetContentRegionAvail().y;
    float logHeight = g_config.showMessageLog ? windowHeight * 0.4f : 0.0f;
    float mappingHeight = windowHeight - logHeight - (g_config.showMessageLog ? 10.0f : 0.0f);

    if (ImGui::BeginChild("MappingsChild", ImVec2(0, mappingHeight), true)) {
        if (ImGui::Button("Learn")) {
            ControlMapping newMapping;
            newMapping.isLearning = true;
            newMapping.displayName = "Learning... Move a control";
            std::string key = "learning_" + std::to_string(g_controlMappings.size());
            g_controlMappings[key] = newMapping;
            g_learningMapping = &g_controlMappings[key];
        }
        ImGui::SameLine(); ImGui::TextDisabled("(Move any MIDI control to auto-map)");
        ImGui::SameLine();
        if (ImGui::Button("Clear All")) g_controlMappings.clear();
        ImGui::SameLine();
        ImGui::Checkbox("Show Message Log", &g_config.showMessageLog);
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

        if (ImGui::BeginTable("MappingsTable", 7, ImGuiTableFlags_Resizable | ImGuiTableFlags_Borders | ImGuiTableFlags_ScrollY | ImGuiTableFlags_RowBg)) {
            ImGui::TableSetupScrollFreeze(0, 1);
            ImGui::TableSetupColumn("Control",   ImGuiTableColumnFlags_WidthFixed, 120.0f);
            ImGui::TableSetupColumn("Data Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("OSC Address", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Range",     ImGuiTableColumnFlags_WidthFixed, 100.0f);
            ImGui::TableSetupColumn("Momentary", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Actions",   ImGuiTableColumnFlags_WidthFixed, 100.0f);
            ImGui::TableSetupColumn("Status",    ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableHeadersRow();

            std::vector<std::string> toDelete;
            for (auto& pair : g_controlMappings) {
                ControlMapping& mapping = pair.second;
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                if (mapping.isLearning) ImGui::TextColored(ImVec4(1,1,0,1), "%s", mapping.displayName.c_str());
                else                    ImGui::Text("%s", mapping.displayName.c_str());

                ImGui::TableNextColumn();
                if (!mapping.isLearning) {
                    if (mapping.dataType == "Boolean")     ImGui::TextColored(ImVec4(0.5f,1,0.5f,1), "%s", mapping.dataType.c_str());
                    else if (mapping.dataType == "Float")  ImGui::TextColored(ImVec4(0.5f,0.5f,1,1), "%s", mapping.dataType.c_str());
                    else if (mapping.dataType == "Integer")ImGui::TextColored(ImVec4(1,0.5f,0.5f,1), "%s", mapping.dataType.c_str());
                    else                                   ImGui::Text("%s", mapping.dataType.c_str());
                }

                ImGui::TableNextColumn();
                if (!mapping.isLearning) {
                    char addressBuffer[256]; strcpy_s(addressBuffer, mapping.oscAddress.c_str());
                    if (ImGui::InputText(("##addr" + pair.first).c_str(), addressBuffer, sizeof(addressBuffer)))
                        mapping.oscAddress = addressBuffer;
                }

                ImGui::TableNextColumn();
                if (!mapping.isLearning) {
                    ImGui::PushItemWidth(50);
                    ImGui::DragFloat(("##min" + pair.first).c_str(), &mapping.minValue, 0.01f, -10.0f, 10.0f);
                    ImGui::SameLine();
                    ImGui::DragFloat(("##max" + pair.first).c_str(), &mapping.maxValue, 0.01f, -10.0f, 10.0f);
                    ImGui::PopItemWidth();
                }

                ImGui::TableNextColumn();
                if (!mapping.isLearning) ImGui::Checkbox(("##momentary" + pair.first).c_str(), &mapping.isMomentary);

                ImGui::TableNextColumn();
                if (ImGui::Button(("Delete##" + pair.first).c_str())) toDelete.push_back(pair.first);

                ImGui::TableNextColumn();
                if (mapping.isLearning)    ImGui::TextColored(ImVec4(1,1,0,1), "Learning");
                else if (mapping.isActive) ImGui::TextColored(ImVec4(0,1,0,1), "Active");
                else                       ImGui::TextColored(ImVec4(0.7f,0.7f,0.7f,1), "Mapped");
            }
            for (const std::string& key : toDelete) g_controlMappings.erase(key);
            ImGui::EndTable();
        }
    }
    ImGui::EndChild();

    if (g_config.showMessageLog) {
        ImGui::Button("##splitter", ImVec2(-1, 8));
        if (ImGui::IsItemActive())
            logHeight = SafeClamp(logHeight + ImGui::GetIO().MouseDelta.y, 100.0f, windowHeight - 100.0f);

        if (ImGui::BeginChild("MessageLogChild", ImVec2(0, 0), true)) {
            ImGui::Text("Message Log - Real-time MIDI/OSC Activity");
            if (ImGui::Button("Clear Log")) { std::lock_guard<std::mutex> lock(g_logMutex); g_messageLog.clear(); }
            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

            if (ImGui::BeginTable("MessageTable", 6, ImGuiTableFlags_Resizable | ImGuiTableFlags_Borders | ImGuiTableFlags_ScrollY | ImGuiTableFlags_RowBg)) {
                ImGui::TableSetupScrollFreeze(0, 1);
                ImGui::TableSetupColumn("Time",        ImGuiTableColumnFlags_WidthFixed, 80.0f);
                ImGui::TableSetupColumn("Type",        ImGuiTableColumnFlags_WidthFixed, 80.0f);
                ImGui::TableSetupColumn("Description", ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("OSC Address", ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("Value",       ImGuiTableColumnFlags_WidthFixed, 60.0f);
                ImGui::TableSetupColumn("Channel",     ImGuiTableColumnFlags_WidthFixed, 60.0f);
                ImGui::TableHeadersRow();

                std::lock_guard<std::mutex> lock(g_logMutex);
                for (const auto& msg : g_messageLog) {
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn(); ImGui::Text("%s", msg.timestamp.c_str());
                    ImGui::TableNextColumn();
                    if (msg.type == "OSC")                          ImGui::TextColored(ImVec4(0.5f,1,0.5f,1), "%s", msg.type.c_str());
                    else if (msg.type.find("Note") != std::string::npos) ImGui::TextColored(ImVec4(1,1,0.5f,1), "%s", msg.type.c_str());
                    else                                            ImGui::Text("%s", msg.type.c_str());
                    ImGui::TableNextColumn(); ImGui::Text("%s", msg.description.c_str());
                    ImGui::TableNextColumn(); ImGui::Text("%s", msg.oscAddress.c_str());
                    ImGui::TableNextColumn(); ImGui::Text("%.3f", msg.normalizedValue);
                    ImGui::TableNextColumn(); ImGui::Text("%d", msg.channel);
                }
                if (ImGui::GetScrollY() >= ImGui::GetScrollMaxY()) ImGui::SetScrollHereY(1.0f);
                ImGui::EndTable();
            }
        }
        ImGui::EndChild();
    }
}

void DrawMIDI_DevicesSubTab() {
    ImGui::Text("MIDI Backend");
    int backendIndex = (int)g_currentMidiBackend;
    if (ImGui::Combo("##MidiBackend", &backendIndex, g_midiBackendNames, IM_ARRAYSIZE(g_midiBackendNames)))
        SwitchMidiBackend((MidiBackend)backendIndex);
    ImGui::SameLine(); ImGui::TextDisabled("(Switch MIDI driver)");
    ImGui::Spacing();
    ImGui::Checkbox("Auto-Connect MIDI", &g_config.autoConnectMIDI);

    static std::vector<std::string> inNames, outNames;
    if (ImGui::Button("Refresh Devices") || inNames.empty()) {
        inNames = GetMidiInDeviceNames();
        outNames = GetMidiOutDeviceNames();
        AutoConnectMIDI();
    }

    ImGui::Text("MIDI Input:");
    if (ImGui::BeginCombo("##MIDIIn2", (g_config.midiInDevice >= 0 && g_config.midiInDevice < (int)inNames.size()) ? inNames[g_config.midiInDevice].c_str() : "Select...")) {
        for (int i = 0; i < (int)inNames.size(); i++) {
            bool sel = (g_config.midiInDevice == i);
            if (ImGui::Selectable(inNames[i].c_str(), sel)) { g_config.midiInDevice = i; OpenMidiInput(i); }
            if (sel) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }

    ImGui::Text("MIDI Output:");
    if (ImGui::BeginCombo("##MIDIOut2", (g_config.midiOutDevice >= 0 && g_config.midiOutDevice < (int)outNames.size()) ? outNames[g_config.midiOutDevice].c_str() : "Select...")) {
        for (int i = 0; i < (int)outNames.size(); i++) {
            bool sel = (g_config.midiOutDevice == i);
            if (ImGui::Selectable(outNames[i].c_str(), sel)) { g_config.midiOutDevice = i; OpenMidiOutput(i); }
            if (sel) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }

    ImGui::Spacing();
    if (g_midiInConnected)  ImGui::TextColored(ImVec4(0,1,0,1), "[OK] MIDI Input Connected");
    else                    ImGui::TextColored(ImVec4(1,0,0,1), "[X] MIDI Input Disconnected");
    if (g_midiOutConnected) ImGui::TextColored(ImVec4(0,1,0,1), "[OK] MIDI Output Connected");
    else                    ImGui::TextColored(ImVec4(1,0,0,1), "[X] MIDI Output Disconnected");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::Checkbox("MIDI Thru", &g_config.midiThru); ImGui::SameLine(); ImGui::TextDisabled("(Pass MIDI input directly to output)");
    ImGui::Checkbox("Send to MIDI", &g_config.sendToMIDI); ImGui::SameLine(); ImGui::TextDisabled("(Convert incoming OSC back to MIDI)");
}

void DrawMIDI_MappingsSubTab() { DrawMappingsTab(); }

void DrawMIDITab() {
    PushSubTabStyle();
    if (ImGui::BeginTabBar("MIDISubTabs")) {
        if (ImGui::BeginTabItem("Devices"))  { DrawMIDI_DevicesSubTab();  ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("Mappings")) { DrawMIDI_MappingsSubTab(); ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("Guitar"))   { DrawGuitarMIDITab();       ImGui::EndTabItem(); }
        ImGui::EndTabBar();
    }
    PopSubTabStyle();
}
