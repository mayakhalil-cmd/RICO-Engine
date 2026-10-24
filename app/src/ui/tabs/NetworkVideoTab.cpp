#include "src/ui/tabs/UICommon.h"
#include "src/video/NetworkVideo.h"
#include "src/video/PluginHost.h"

static const ImVec4 kGood(0.23f, 1.0f, 0.01f, 1.0f);
static const ImVec4 kWarn(1.0f, 0.75f, 0.1f, 1.0f);
static const ImVec4 kHead(0.0f, 1.0f, 1.0f, 1.0f);

static void DrawTransportPicker() {
    const auto& list = PluginHost_Transports();
    ImGui::TextColored(kHead, "TRANSPORT");
    ImGui::Spacing();

    for (int i = 0; i < (int)list.size(); ++i) {
        const auto& t = list[i];
        bool available = NetVideo_TransportAvailable(i);
        if (!available) ImGui::BeginDisabled();
        if (ImGui::RadioButton((t.name + "##transport").c_str(), g_netVideo.transport == i))
            NetVideo_SelectTransport(i);
        if (!available) ImGui::EndDisabled();
        ImGui::SameLine();
        ImGui::TextDisabled("%s%s", t.builtIn ? "built in. " : "plugin. ", t.description.c_str());
        if (!available) {
            ImGui::Indent();
            ImGui::TextColored(kWarn, "%s", t.api->status_text());
            if (!t.homepage.empty()) ImGui::TextDisabled("Get it here: %s", t.homepage.c_str());
            ImGui::Unindent();
        }
    }

    for (const auto& p : PluginHost_Problems())
        ImGui::TextColored(kWarn, "%s was skipped: %s", p.file.c_str(), p.reason.c_str());

    ImGui::TextDisabled("Plugins folder: %s", PluginHost_Folder().c_str());
    ImGui::SameLine();
    if (ImGui::SmallButton("Rescan")) {
        NetVideo_Shutdown();
        NetVideo_Init();
    }
}

static void DrawSend() {
    ImGui::TextColored(kHead, "SEND");
    ImGui::Spacing();
    ImGui::SetNextItemWidth(260);
    ImGui::InputText("Stream name", g_netVideo.senderName, sizeof(g_netVideo.senderName));

    int source = (int)g_netVideo.source;
    ImGui::Text("What to send:");
    if (ImGui::RadioButton("RICO window", source == 0)) NetVideo_SetSource(NetVideoSource::Window);
    ImGui::SameLine();
    if (ImGui::RadioButton("Whole screen", source == 1)) NetVideo_SetSource(NetVideoSource::Screen, g_netVideo.monitor);
    ImGui::SameLine();
    if (ImGui::RadioButton("Re-send what I receive", source == 2)) NetVideo_SetSource(NetVideoSource::Passthrough);
    ImGui::SameLine();
    if (ImGui::RadioButton("Create canvas", source == 3)) NetVideo_SetSource(NetVideoSource::Canvas);
    ImGui::SameLine();
    if (ImGui::RadioButton("Spout input", source == 4)) NetVideo_SetSource(NetVideoSource::Spout);

    if (g_netVideo.source == NetVideoSource::Screen) {
        int monitor = g_netVideo.monitor;
        ImGui::SetNextItemWidth(120);
        if (ImGui::Combo("Monitor", &monitor, "Monitor 1\0Monitor 2\0Monitor 3\0Monitor 4\0"))
            NetVideo_SetSource(NetVideoSource::Screen, monitor);
    }

    ImGui::Spacing();
    if (!g_netVideo.sending) {
        if (ImGui::Button("Start sending", ImVec2(160, 32))) NetVideo_StartSending();
    } else {
        if (ImGui::Button("Stop sending", ImVec2(160, 32))) NetVideo_StopSending();
        ImGui::SameLine();
        ImGui::TextColored(kGood, "LIVE  \"%s\" over %s  %dx%d",
                           g_netVideo.senderName, NetVideo_TransportName(),
                           g_netVideo.width, g_netVideo.height);
    }
}

static void DrawReceive() {
    ImGui::TextColored(kHead, "RECEIVE");
    ImGui::Spacing();
    if (ImGui::Button("Find sources", ImVec2(160, 28))) NetVideo_RefreshSources();
    ImGui::SameLine();
    ImGui::TextDisabled("Looks for %s streams on your network", NetVideo_TransportName());

    const auto& sources = NetVideo_Sources();
    if (sources.empty()) ImGui::TextDisabled("Nothing found yet.");
    for (int i = 0; i < (int)sources.size(); ++i) {
        bool connected = g_netVideo.receiving && sources[i] == g_netVideo.sourceName;
        ImGui::PushID(i);
        if (connected) {
            ImGui::TextColored(kGood, "%s", sources[i].c_str());
            ImGui::SameLine();
            if (ImGui::SmallButton("Disconnect")) NetVideo_Disconnect();
        } else {
            ImGui::Text("%s", sources[i].c_str());
            ImGui::SameLine();
            if (ImGui::SmallButton("Connect")) NetVideo_Connect(sources[i].c_str());
        }
        ImGui::PopID();
    }

    static char manual[256] = "";
    ImGui::SetNextItemWidth(260);
    ImGui::InputTextWithHint("##manual", "Source name or address", manual, sizeof(manual));
    ImGui::SameLine();
    if (ImGui::Button("Connect##manual")) NetVideo_Connect(manual);

    if (g_netVideo.receiving) {
        ImGui::Spacing();
        if (g_netVideo.receivedWidth > 0) {
            ImGui::TextColored(kGood, "Receiving \"%s\"  %dx%d", g_netVideo.sourceName,
                               g_netVideo.receivedWidth, g_netVideo.receivedHeight);
            if (ID3D11ShaderResourceView* srv = NetVideo_ReceivedSRV()) {
                float w = 320.0f;
                float h = w * g_netVideo.receivedHeight / (float)g_netVideo.receivedWidth;
                ImGui::Image((ImTextureID)srv, ImVec2(w, h));
            }
        } else {
            ImGui::TextColored(kWarn, "Connected to \"%s\", waiting for video...", g_netVideo.sourceName);
        }
    }

    ImGui::Spacing();
    ImGui::Checkbox("Also share it as a Spout sender", &g_netVideo.bridgeToSpout);
    ImGui::SameLine();
    ImGui::SetNextItemWidth(200);
    ImGui::InputText("##spoutBridge", g_netVideo.spoutBridgeName, sizeof(g_netVideo.spoutBridgeName));
    ImGui::TextDisabled("Use this to get OMT video into TouchDesigner, Resolume or OBS on this computer.");
}

void DrawNetworkVideoTab() {
    ImGui::TextWrapped("Send and receive video over your network. OMT is open source and built in. "
                       "Other transports, like NDI, can be added as plugins.");
    ImGui::Spacing();
    DrawTransportPicker();
    ImGui::Separator();
    DrawSend();
    ImGui::Separator();
    DrawReceive();
    if (!g_netVideo.lastError.empty()) {
        ImGui::Separator();
        ImGui::TextColored(kWarn, "%s", g_netVideo.lastError.c_str());
    }
}
