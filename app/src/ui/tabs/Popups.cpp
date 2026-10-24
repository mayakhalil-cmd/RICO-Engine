#include "src/ui/tabs/UICommon.h"

void DrawAccessibilityPopup() {
    if (g_showAccessibilityPopup) { ImGui::OpenPopup("Accessibility"); g_showAccessibilityPopup = false; }

    ImGui::SetNextWindowSize(ImVec2(560, 520), ImGuiCond_Always);
    if (ImGui::BeginPopupModal("Accessibility", nullptr, ImGuiWindowFlags_NoResize)) {
        ImGui::TextColored(ImVec4(0,1,1,1), "Accessibility Settings");
        ImGui::TextDisabled("Changes apply immediately and persist while RICO is open.");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextColored(ImVec4(1,1,0,1), "COLOR BLIND MODE");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextWrapped("Remaps all UI colors so they are distinguishable for your vision type.");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

        bool changed = false;
        if (ImGui::RadioButton("None (default)",               &g_colorBlindMode, 0)) changed = true;
        ImGui::SameLine(200);
        if (ImGui::RadioButton("Deuteranopia##cb",             &g_colorBlindMode, 1)) changed = true;
        ImGui::TextDisabled("                                          Red-green (most common, ~6%% of males)");
        if (ImGui::RadioButton("Protanopia##cb",               &g_colorBlindMode, 2)) changed = true;
        ImGui::SameLine(200);
        if (ImGui::RadioButton("Tritanopia##cb",               &g_colorBlindMode, 3)) changed = true;
        ImGui::TextDisabled("Red deficiency (~1%%)                     Blue-yellow deficiency (~0.01%%)");
        if (ImGui::RadioButton("Achromatopsia (full greyscale)##cb", &g_colorBlindMode, 4)) changed = true;
        ImGui::TextDisabled("Complete color blindness - extremely rare");
        if (changed) ApplyAccessibilityStyle();

        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextColored(ImVec4(1,1,0,1), "HIGH CONTRAST");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextWrapped("Black background with white text and bright blue buttons. Helps with low vision, photosensitivity, and reading clarity.");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (ImGui::Checkbox("Enable High Contrast Mode", &g_highContrast)) ApplyAccessibilityStyle();

        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextColored(ImVec4(1,1,0,1), "DYSLEXIA SUPPORT");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextWrapped("Increases spacing between UI elements. Extra whitespace reduces letter crowding.");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (ImGui::Checkbox("Wider Spacing",       &g_dyslexiaSpacing)) ApplyAccessibilityStyle();
        ImGui::SameLine(); ImGui::TextDisabled("(more room between elements)");
        if (ImGui::Checkbox("OpenDyslexic Font",   &g_dyslexiaFont))    ApplyAccessibilityStyle();
        ImGui::SameLine(); ImGui::TextDisabled("(weighted letters to reduce flipping)");
        if (g_dyslexiaFont) {
            ImGui::SetNextItemWidth(300);
            if (ImGui::SliderFloat("Dyslexia Font Size", &g_dyslexiaFontScale, 0.5f, 1.0f, "%.1fx"))
                ImGui::GetIO().FontGlobalScale = g_dyslexiaFontScale;
            ImGui::SameLine();
            if (ImGui::Button("Reset##dysfontsz")) { g_dyslexiaFontScale=1.0f; ImGui::GetIO().FontGlobalScale=1.0f; }
        }

        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextColored(ImVec4(1,1,0,1), "TEXT SIZE"); ImGui::Spacing();
        ImGui::TextWrapped("Increase font size if text is hard to read.");
        ImGui::Spacing();
        ImGui::SetNextItemWidth(300);
        if (ImGui::SliderFloat("Font Scale", &g_uiFontScale, 0.8f, 2.0f, "%.1fx"))
            ImGui::GetIO().FontGlobalScale = g_uiFontScale;
        ImGui::SameLine();
        if (ImGui::Button("Reset##fontscale")) { g_uiFontScale=1.0f; ImGui::GetIO().FontGlobalScale=1.0f; }
        ImGui::TextDisabled("1.0x = default  |  1.5x recommended for dyslexia  |  2.0x for low vision");

        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextColored(ImVec4(0,1,1,1), "ACTIVE:"); ImGui::SameLine();
        const char* cbNames[] = { "None","Deuteranopia","Protanopia","Tritanopia","Achromatopsia" };
        ImGui::Text("Color Blind Mode: %s  |  High Contrast: %s  |  Dyslexia Spacing: %s  |  Scale: %.1fx",
            cbNames[g_colorBlindMode], g_highContrast?"ON":"OFF", g_dyslexiaSpacing?"ON":"OFF", g_uiFontScale);
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (ImGui::Button("Reset All to Default", ImVec2(160,30))) {
            g_colorBlindMode=0; g_highContrast=false; g_dyslexiaSpacing=false; g_dyslexiaFont=false;
            g_uiFontScale=1.0f; ImGui::GetIO().FontGlobalScale=1.0f; ApplyAccessibilityStyle();
        }
        ImGui::SameLine();
        if (ImGui::Button("Close", ImVec2(100,30))) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }
}

void DrawHelpPopups() {
    if (g_showAboutPopup)       { ImGui::OpenPopup("About");       g_showAboutPopup = false; }
    if (g_showPresetGuidePopup) { ImGui::OpenPopup("PresetGuide"); g_showPresetGuidePopup = false; }

    ImGui::SetNextWindowSize(ImVec2(700, 500), ImGuiCond_Always);
    if (ImGui::BeginPopupModal("About", nullptr, ImGuiWindowFlags_NoResize)) {
        ImGui::Text("MIDI <-> OSC Router v2.1 - Complete Guide");
        ImGui::Separator();
        if (ImGui::BeginTabBar("AboutTabs")) {
            if (ImGui::BeginTabItem("Overview")) {
                ImGui::TextWrapped("This tool creates a bridge between MIDI controllers and OSC-compatible applications, enabling real-time control of software parameters using hardware controllers.");
                ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
                ImGui::Text("Core Functions:");
                ImGui::BulletText("MIDI to OSC: Converts MIDI messages to OSC with proper data types");
                ImGui::BulletText("OSC to MIDI: Converts incoming OSC back to MIDI messages");
                ImGui::BulletText("Multi-destination: Send to multiple applications simultaneously");
                ImGui::BulletText("Bidirectional: Full two-way communication support");
                ImGui::BulletText("Real-time: Zero-latency message processing");
                ImGui::BulletText("Auto-mapping: Automatically detects and maps MIDI controls");
                ImGui::EndTabItem();
            }
            if (ImGui::BeginTabItem("Multi-Destination")) {
                ImGui::Text("New Multi-Destination OSC Feature:");
                ImGui::BulletText("Send same MIDI signals to multiple apps on different ports");
                ImGui::BulletText("No more 'port already in use' errors");
                ImGui::BulletText("Control Unreal Engine + TouchDesigner + others simultaneously");
                ImGui::BulletText("Each destination can have different IP:Port combinations");
                ImGui::BulletText("Enable/disable destinations individually");
                ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
                ImGui::Text("How to Use:");
                ImGui::BulletText("Go to 'OSC Destinations' tab");
                ImGui::BulletText("Add multiple destinations with different ports");
                ImGui::BulletText("Use Quick Add to add common applications");
                ImGui::EndTabItem();
            }
            if (ImGui::BeginTabItem("Button Guide")) {
                ImGui::Text("Dashboard Controls:");
                ImGui::BulletText("Auto Local IP: Automatically detects your computer's IP address");
                ImGui::BulletText("Refresh Devices: Scans for new MIDI input/output devices");
                ImGui::BulletText("Send to OSC: Enables MIDI-to-OSC conversion");
                ImGui::BulletText("Send to MIDI: Enables OSC-to-MIDI conversion");
                ImGui::BulletText("Receive from OSC: Listens for incoming OSC messages");
                ImGui::BulletText("MIDI Thru: Passes MIDI input directly to MIDI output");
                ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
                ImGui::Text("Mapping Controls:");
                ImGui::BulletText("Learn: Click then move any MIDI control to auto-map it");
                ImGui::BulletText("Clear All: Removes all current control mappings");
                ImGui::BulletText("Show Message Log: Toggles real-time activity monitor");
                ImGui::EndTabItem();
            }
            if (ImGui::BeginTabItem("Quick Start")) {
                ImGui::Text("Setup in 5 Steps:");
                ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
                ImGui::BulletText("1. Plug in USB MIDI controller");
                ImGui::BulletText("2. Go to OSC Destinations tab, add your apps");
                ImGui::BulletText("3. Move any MIDI control - it auto-maps instantly");
                ImGui::BulletText("4. Check 'Send to OSC' on Dashboard");
                ImGui::BulletText("5. Watch the Live Key Detector for activity");
                ImGui::EndTabItem();
            }
            ImGui::EndTabBar();
        }
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (ImGui::Button("Close", ImVec2(120,30))) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }

    ImGui::SetNextWindowSize(ImVec2(700, 500), ImGuiCond_Always);
    if (ImGui::BeginPopupModal("PresetGuide", nullptr, ImGuiWindowFlags_NoResize)) {
        ImGui::Text("Application Setup Guide - Click preset for details");
        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

        int col = 0;
        for (const auto& pair : g_presets) {
            if (ImGui::Button(pair.second.name.c_str(), ImVec2(120,30))) g_selectedPresetForHelp = pair.first;
            if (++col % 4 != 0) ImGui::SameLine();
        }
        ImGui::NewLine();

        if (g_selectedPresetForHelp >= 0 && g_presets.find(g_selectedPresetForHelp) != g_presets.end()) {
            const OSCPreset& preset = g_presets[g_selectedPresetForHelp];
            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
            ImGui::Text("Setup Guide: %s", preset.name.c_str()); ImGui::Spacing();
            if (ImGui::BeginTabBar("PresetDetailTabs")) {
                if (ImGui::BeginTabItem("Overview")) {
                    ImGui::TextWrapped("%s", preset.description.c_str()); ImGui::Spacing();
                    ImGui::BulletText("Default Address: %s", preset.baseAddress.c_str());
                    ImGui::BulletText("Default Port:    %d", preset.port);
                    ImGui::BulletText("Address Style:   %s", preset.useIndexedAddresses ? "Indexed (/param1, /param2)" : "Named (/param/name)");
                    ImGui::EndTabItem();
                }
                if (ImGui::BeginTabItem("MIDI Setup"))    { ImGui::TextWrapped("%s", preset.midiConfig.c_str());        ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("OSC Setup"))     { ImGui::TextWrapped("%s", preset.oscConfig.c_str());         ImGui::EndTabItem(); }
                if (ImGui::BeginTabItem("Instructions"))  { ImGui::TextWrapped("%s", preset.setupInstructions.c_str()); ImGui::EndTabItem(); }
                ImGui::EndTabBar();
            }
            ImGui::Spacing();
            if (ImGui::Button(("Load " + preset.name + " Preset").c_str(), ImVec2(180,30))) {
                LoadPreset(g_selectedPresetForHelp); ImGui::CloseCurrentPopup();
            }
        }

        ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        if (ImGui::Button("Close", ImVec2(120,30))) { ImGui::CloseCurrentPopup(); g_selectedPresetForHelp = -1; }
        ImGui::EndPopup();
    }
}
