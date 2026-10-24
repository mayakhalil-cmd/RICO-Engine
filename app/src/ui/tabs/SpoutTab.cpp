#include "src/ui/tabs/UICommon.h"

void DrawSpout_ReceiveSubTab() {
    ImGui::Text("Receive Spout Texture from TouchDesigner / OBS / Any Spout Sender");
    ImGui::Separator();

    ImGui::TextColored(ImVec4(0, 1, 1, 1), "SOURCE DISCOVERY");
    ImGui::Spacing();

    float nowSec = (float)GetTickCount() / 1000.0f;
    if (ImGui::Button("Scan for Spout Senders", ImVec2(190, 35)))
        UpdateSpoutSenderList();
    ImGui::SameLine();
    if (g_spoutState.lastScanTime > 0)
        ImGui::TextDisabled("Last scan: %.0fs ago", nowSec - g_spoutState.lastScanTime);
    else
        ImGui::TextDisabled("Click to find senders on this machine");

    ImGui::Spacing();

    if (g_spoutSenderList.empty()) {
        ImGui::TextColored(ImVec4(0.7f, 0.7f, 0.7f, 1), "No senders found - click Scan above");
        ImGui::TextDisabled("Make sure TouchDesigner / OBS is running and sending Spout");
    }
    else {
        ImGui::Text("Available Senders (%d found):", (int)g_spoutSenderList.size());
        ImGui::Spacing();
        for (int i = 0; i < (int)g_spoutSenderList.size(); i++) {
            bool isConnected = g_spoutState.receiverInitialized &&
                std::string(g_spoutState.receiverName) == g_spoutSenderList[i];
            if (isConnected) {
                ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0.2f, 0, 0.5f));
                if (ImGui::BeginChild(("src_sp_" + std::to_string(i)).c_str(), ImVec2(0, 40), true)) {
                    ImGui::TextColored(ImVec4(0, 1, 0, 1), "[CONNECTED] %s", g_spoutSenderList[i].c_str());
                    if (g_spoutState.receivedWidth > 0) {
                        ImGui::SameLine();
                        ImGui::TextColored(ImVec4(0, 1, 0, 1), "  %dx%d", g_spoutState.receivedWidth, g_spoutState.receivedHeight);
                    }
                    ImGui::SameLine(ImGui::GetContentRegionAvail().x - 100);
                    if (ImGui::Button(("Disconnect##sp" + std::to_string(i)).c_str()))
                        DisconnectSpoutReceiver();
                }
                ImGui::EndChild();
                ImGui::PopStyleColor();
            }
            else {
                ImGui::Text("  %s", g_spoutSenderList[i].c_str());
                ImGui::SameLine();
                if (ImGui::Button(("Connect##sp" + std::to_string(i)).c_str()))
                    ConnectSpoutReceiver(g_spoutSenderList[i].c_str());
            }
        }
    }

    ImGui::Spacing();
    ImGui::Separator();

    ImGui::TextColored(ImVec4(0, 1, 1, 1), "MANUAL CONNECTION");
    ImGui::Spacing();
    ImGui::Text("Sender name (if not in scan list):");
    ImGui::InputText("##spoutManualName", g_spoutState.receiverName, sizeof(g_spoutState.receiverName));
    ImGui::SameLine();
    if (ImGui::Button("Connect##spoutManual", ImVec2(90, 0)))
        ConnectSpoutReceiver(g_spoutState.receiverName);
    ImGui::SameLine();
    if (ImGui::Button("Disconnect##spoutManual", ImVec2(90, 0)))
        DisconnectSpoutReceiver();

    ImGui::Spacing();
    ImGui::Separator();

    ImGui::TextColored(ImVec4(0, 1, 1, 1), "RECEIVER STATUS");
    ImGui::Spacing();
    if (g_spoutState.receiverInitialized) {
        if (g_spoutState.receivedWidth > 0 && g_spoutState.receivedHeight > 0)
            ImGui::TextColored(ImVec4(0, 1, 0, 1), "[OK] Receiving from \"%s\"  %dx%d",
                g_spoutState.receiverName, g_spoutState.receivedWidth, g_spoutState.receivedHeight);
        else
            ImGui::TextColored(ImVec4(1, 1, 0, 1), "[WAITING] Connected to \"%s\", waiting for frames...",
                g_spoutState.receiverName);
    }
    else {
        ImGui::TextColored(ImVec4(1, 0, 0, 1), "[X] No active receiver");
    }

    ImGui::Spacing();
    ImGui::Separator();

    ImGui::TextColored(ImVec4(0, 1, 1, 1), "LIVE PREVIEW");
    ImGui::Spacing();

    if (g_spoutState.displaySRV && g_spoutState.receivedWidth > 0 && g_spoutState.receivedHeight > 0) {
        float aspect = (float)g_spoutState.receivedWidth / (float)g_spoutState.receivedHeight;
        float previewW = ImGui::GetContentRegionAvail().x;
        float previewH = previewW / aspect;
        if (previewH > 400.0f) { previewH = 400.0f; previewW = previewH * aspect; }
        ImGui::Image((ImTextureID)g_spoutState.displaySRV, ImVec2(previewW, previewH));
        ImGui::TextDisabled("Live feed from \"%s\"  |  %dx%d",
            g_spoutState.receiverName, g_spoutState.receivedWidth, g_spoutState.receivedHeight);
    }
    else if (g_spoutState.receiverInitialized) {
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.05f, 0.05f, 0.05f, 1));
        ImGui::BeginChild("SpoutNoFrame", ImVec2(-1, 120), true);
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 40);
        ImGui::SetCursorPosX((ImGui::GetWindowWidth() - ImGui::CalcTextSize("Waiting for first frame...").x) * 0.5f);
        ImGui::TextColored(ImVec4(1, 1, 0, 1), "Waiting for first frame...");
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }
    else {
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.05f, 0.05f, 0.05f, 1));
        ImGui::BeginChild("SpoutNoConn", ImVec2(-1, 120), true);
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 40);
        ImGui::SetCursorPosX((ImGui::GetWindowWidth() - ImGui::CalcTextSize("Not connected").x) * 0.5f);
        ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1), "Not connected");
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    ImGui::Spacing();
    if (ImGui::CollapsingHeader("How to Use Spout Receive")) {
        ImGui::BulletText("1. Open TouchDesigner, add a Spout Out TOP");
        ImGui::BulletText("2. Give it a sender name (e.g. 'spoutout')");
        ImGui::BulletText("3. Click Scan above - it will appear in the list");
        ImGui::BulletText("4. Click Connect - live preview appears immediately");
        ImGui::BulletText("5. Go to AE Export tab to pipe it into After Effects");
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(1, 1, 0, 1), "Note: Spout only works on the same physical machine");
        ImGui::TextDisabled("Use the Network Video tab to send video to another computer");
    }
}

void DrawSpout_SendSubTab() {
    ImGui::Text("Send Spout Texture from RICO to Other Applications");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    ImGui::TextColored(ImVec4(0, 1, 1, 1), "SENDER CONFIGURATION");
    ImGui::Spacing();
    ImGui::InputText("Sender Name", g_spoutState.senderName, sizeof(g_spoutState.senderName));
    ImGui::SameLine(); ImGui::TextDisabled("(Name visible to TouchDesigner / OBS)");
    ImGui::Spacing();

    if (!g_spoutState.initialized) {
        if (ImGui::Button("Start Spout Sender", ImVec2(200, 35)))
            SpoutSender_Start();
        ImGui::SameLine();
        ImGui::TextColored(ImVec4(1, 0, 0, 1), "Not sending");
    }
    else {
        ImGui::TextColored(ImVec4(0, 1, 0, 1), "[OK] Sender Active as \"%s\"", g_spoutState.senderName);
        ImGui::Spacing();
        ImGui::BulletText("Sends: RICO render target (the app window)");
        ImGui::BulletText("Receivers see the entire RICO UI as a live texture");
        ImGui::Spacing();
        if (ImGui::Button("Shutdown Sender", ImVec2(160, 30))) {
            SpoutSender_Stop();
        }
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0, 1, 1, 1), "STATUS");
    ImGui::Spacing();
    ImGui::Text("SDK:    "); ImGui::SameLine(); ImGui::TextColored(ImVec4(0, 1, 0, 1), "SpoutDX - Compiled In");
    ImGui::Text("Sender: "); ImGui::SameLine();
    if (g_spoutState.initialized)
        ImGui::TextColored(ImVec4(0, 1, 0, 1), "Active - \"%s\"", g_spoutState.senderName);
    else
        ImGui::TextColored(ImVec4(0.7f, 0.7f, 0.7f, 1), "Off");

    ImGui::Spacing();
    if (ImGui::CollapsingHeader("How to Receive in TouchDesigner / OBS")) {
        ImGui::BulletText("TouchDesigner: Add Spout In TOP, set Sender Name to \"%s\"", g_spoutState.senderName);
        ImGui::BulletText("OBS: Add 'Spout2 Capture' source, select \"%s\"", g_spoutState.senderName);
        ImGui::BulletText("Any Spout-compatible app will see it in their sender list");
    }
}

void DrawSpout_AEExportSubTab() {
    ImGui::TextColored(ImVec4(0, 1, 1, 1), "Export Live Spout Frame to After Effects");
    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextWrapped(
        "Exports a D3D11 shared texture handle that an After Effects plugin can open "
        "directly - giving AE a live GPU texture from TouchDesigner with zero copies.");
    ImGui::Spacing();

    ImGui::TextColored(ImVec4(1, 1, 0, 1), "DEPENDENCY CHECK");
    ImGui::Spacing();
    bool receiverOK = g_spoutState.receiverInitialized && g_spoutState.receivedWidth > 0;
    if (receiverOK)
        ImGui::TextColored(ImVec4(0, 1, 0, 1), "[OK] Spout Receiver connected (%dx%d)",
            g_spoutState.receivedWidth, g_spoutState.receivedHeight);
    else {
        ImGui::TextColored(ImVec4(1, 0, 0, 1), "[X] Spout Receiver not connected");
        ImGui::TextDisabled("    -> Go to Receive tab and connect a sender first");
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0, 1, 1, 1), "EXPORT SETTINGS");
    ImGui::Spacing();

    ImGui::Checkbox("Enable AE Shared Texture Export", &g_spoutState.exportSharedHandle);
    ImGui::SameLine(); ImGui::TextDisabled("(Writes handle file that AE plugin reads)");

    if (g_spoutState.exportSharedHandle) {
        ImGui::Spacing();
        ImGui::InputText("Handle File Path", g_spoutState.sharedHandlePath, sizeof(g_spoutState.sharedHandlePath));
        ImGui::TextDisabled("AE plugin reads this file to open the shared texture");
        ImGui::Spacing();
        if (!receiverOK)
            ImGui::TextColored(ImVec4(1, 0.5f, 0, 1), "Waiting for Spout receiver to connect...");
        else if (g_spoutState.sharedTextureHandle)
            ImGui::TextColored(ImVec4(0, 1, 0, 1), "[EXPORTING]  Handle: 0x%llx  |  %dx%d",
                (unsigned long long)g_spoutState.sharedTextureHandle,
                g_spoutState.receivedWidth, g_spoutState.receivedHeight);
        else
            ImGui::TextColored(ImVec4(1, 1, 0, 1), "Connected - shared texture created on next frame...");
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0, 1, 1, 1), "WORKFLOW");
    ImGui::Spacing();
    ImGui::BulletText("1. Connect a Spout sender in the Receive tab");
    ImGui::BulletText("2. Enable export above and set the file path");
    ImGui::BulletText("3. Handle file is written automatically each frame");
    ImGui::BulletText("4. In AE: apply the RICO plugin to a solid layer");
    ImGui::BulletText("5. Plugin reads the handle and shows the live texture");
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0, 1, 1, 1), "SHARED HANDLE INFO");
    ImGui::Spacing();
    if (g_spoutState.sharedTextureHandle) {
        ImGui::Text("Handle:     0x%llx", (unsigned long long)g_spoutState.sharedTextureHandle);
        ImGui::Text("Resolution: %dx%d", g_spoutState.receivedWidth, g_spoutState.receivedHeight);
        ImGui::Text("Format:     DXGI_FORMAT_B8G8R8A8_UNORM");
        ImGui::Text("File:       %s", g_spoutState.sharedHandlePath);
        ImGui::Spacing();
        if (ImGui::Button("Copy Handle to Clipboard", ImVec2(200, 30))) {
            char buf[64];
            sprintf_s(buf, "0x%llx", (unsigned long long)g_spoutState.sharedTextureHandle);
            ImGui::SetClipboardText(buf);
        }
        ImGui::SameLine();
        if (ImGui::Button("Reset Shared Texture", ImVec2(180, 30))) {
            if (g_sharedTexture) { g_sharedTexture->Release(); g_sharedTexture = nullptr; }
            g_spoutState.sharedTextureHandle = nullptr;
        }
    }
    else {
        ImGui::TextDisabled("No active shared handle yet");
    }
}

void DrawSpoutTab() {
    PushSubTabStyle();
    if (ImGui::BeginTabBar("SpoutSubTabs")) {
        if (ImGui::BeginTabItem("Receive"))    { DrawSpout_ReceiveSubTab();   ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("Send"))       { DrawSpout_SendSubTab();      ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("AE Export"))  { DrawSpout_AEExportSubTab();  ImGui::EndTabItem(); }
        ImGui::EndTabBar();
    }
    PopSubTabStyle();
}
