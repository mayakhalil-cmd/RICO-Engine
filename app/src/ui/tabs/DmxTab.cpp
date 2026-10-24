#include "src/ui/tabs/UICommon.h"

bool InitArtNet() {
    if (g_artnetState.initialized) return true;

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    g_artnetSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (g_artnetSocket == INVALID_SOCKET) return false;

    BOOL broadcast = TRUE;
    setsockopt(g_artnetSocket, SOL_SOCKET, SO_BROADCAST,
        (char*)&broadcast, sizeof(broadcast));

    g_artnetState.initialized = true;
    return true;
}

void CleanupArtNet() {
    if (g_artnetSocket != INVALID_SOCKET) {
        closesocket(g_artnetSocket);
        g_artnetSocket = INVALID_SOCKET;
    }
    g_artnetState.initialized = false;
}

void SendArtNetDMX() {
    if (!g_artnetState.initialized || g_artnetSocket == INVALID_SOCKET) return;

    uint8_t packet[530] = {};
    memcpy(packet, "Art-Net\0", 8);
    packet[8]  = 0x00;
    packet[9]  = 0x50;
    packet[10] = 0x00;
    packet[11] = 14;
    packet[12] = (uint8_t)g_artnetState.sequence++;
    packet[13] = 0;
    packet[14] = g_artnetState.universe & 0xFF;
    packet[15] = (g_artnetState.universe >> 8) & 0xFF;
    packet[16] = 0x02;
    packet[17] = 0x00;
    memcpy(packet + 18, g_artnetState.dmxData, 512);

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(6454);
    addr.sin_addr.s_addr = inet_addr(g_artnetState.targetIP);
    sendto(g_artnetSocket, (char*)packet, 530, 0, (sockaddr*)&addr, sizeof(addr));
}

void SetDMXChannel(int channel, float normalizedValue) {
    if (channel < 1 || channel > 512) return;
    g_artnetState.dmxData[channel - 1] = (uint8_t)(normalizedValue * 255.0f);
}

void RouteArtNetMappings(int midiCC, int midiCh, float normalizedValue) {
    for (auto& m : g_artnetMappings) {
        if (!m.enabled) continue;
        if (m.midiCC == midiCC && m.midiChannel == midiCh) {
            float scaled = m.minVal + normalizedValue * (m.maxVal - m.minVal);
            m.currentValue = scaled;
            SetDMXChannel(m.dmxChannel, scaled);
        }
    }
}

void DrawDMXTab() {
    PushSubTabStyle();
    if (ImGui::BeginTabBar("DMXSubTabs")) {

        if (ImGui::BeginTabItem("Universes")) {
            ImGui::Text("Art-Net / DMX Output");
            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

            ImGui::TextColored(ImVec4(0, 1, 1, 1), "CONNECTION");
            ImGui::Spacing();
            ImGui::InputText("Target IP", g_artnetState.targetIP, sizeof(g_artnetState.targetIP));
            ImGui::SameLine(); ImGui::TextDisabled("(255.255.255.255 = broadcast to all on network)");
            ImGui::InputInt("Universe", &g_artnetState.universe);
            g_artnetState.universe = SafeClamp(g_artnetState.universe, 0, 32767);
            ImGui::SameLine(); ImGui::TextDisabled("(0-32767, most fixtures use universe 0 or 1)");

            ImGui::Spacing();
            if (!g_artnetState.initialized) {
                if (ImGui::Button("Initialize Art-Net", ImVec2(180, 35))) {
                    if (InitArtNet()) ImGui::OpenPopup("ArtNetOK");
                }
                ImGui::SameLine();
                ImGui::TextColored(ImVec4(1, 0, 0, 1), "[X] Not Initialized");
            }
            else {
                ImGui::TextColored(ImVec4(0, 1, 0, 1), "[OK] Art-Net Ready - broadcasting to %s universe %d",
                    g_artnetState.targetIP, g_artnetState.universe);
                if (ImGui::Button("Shutdown Art-Net", ImVec2(180, 30))) CleanupArtNet();
            }

            if (ImGui::BeginPopupModal("ArtNetOK", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
                ImGui::TextColored(ImVec4(0, 1, 0, 1), "[OK] Art-Net initialized!");
                ImGui::Text("Ready to send DMX to %s on universe %d", g_artnetState.targetIP, g_artnetState.universe);
                if (ImGui::Button("OK")) ImGui::CloseCurrentPopup();
                ImGui::EndPopup();
            }

            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
            ImGui::TextColored(ImVec4(0, 1, 1, 1), "MANUAL DMX FADERS (for testing)");
            ImGui::Spacing();
            ImGui::TextDisabled("Drag any channel to send DMX immediately");
            ImGui::Spacing();

            static int manualChannelStart = 1;
            ImGui::InputInt("Start Channel", &manualChannelStart);
            manualChannelStart = SafeClamp(manualChannelStart, 1, 497);

            ImGui::Spacing();
            bool anyChanged = false;
            for (int i = 0; i < 16; i++) {
                int ch = manualChannelStart + i;
                float val = g_artnetState.dmxData[ch - 1] / 255.0f;
                char label[16];
                sprintf_s(label, "CH %d", ch);
                ImGui::PushID(ch);
                if (ImGui::SliderFloat(label, &val, 0.0f, 1.0f, "%.2f")) {
                    SetDMXChannel(ch, val);
                    anyChanged = true;
                }
                ImGui::PopID();
                ImGui::Spacing();
            }
            if (anyChanged && g_artnetState.initialized) SendArtNetDMX();

            ImGui::Spacing();
            if (ImGui::Button("All Channels OFF", ImVec2(160, 30))) {
                memset(g_artnetState.dmxData, 0, sizeof(g_artnetState.dmxData));
                if (g_artnetState.initialized) SendArtNetDMX();
            }
            ImGui::SameLine();
            if (ImGui::Button("All Channels FULL", ImVec2(160, 30))) {
                memset(g_artnetState.dmxData, 255, sizeof(g_artnetState.dmxData));
                if (g_artnetState.initialized) SendArtNetDMX();
            }
            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Channel Map")) {
            ImGui::Text("DMX Channel Map - All 512 Channels");
            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
            ImGui::TextDisabled("Visual overview of all active channels");
            ImGui::Spacing();

            if (ImGui::BeginTable("DMXGrid", 32,
                ImGuiTableFlags_Borders | ImGuiTableFlags_ScrollY,
                ImVec2(0, 400))) {
                for (int row = 0; row < 16; row++) {
                    ImGui::TableNextRow();
                    for (int col = 0; col < 32; col++) {
                        int ch = row * 32 + col;
                        ImGui::TableNextColumn();
                        float val = g_artnetState.dmxData[ch] / 255.0f;
                        if (val > 0)
                            ImGui::TextColored(ImVec4(val, val * 0.5f, 0, 1), "%d\n%d", ch + 1, g_artnetState.dmxData[ch]);
                        else
                            ImGui::TextDisabled("%d", ch + 1);
                    }
                }
                ImGui::EndTable();
            }
            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("MIDI -> DMX")) {
            ImGui::Text("Map MIDI Controls to DMX Channels");
            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

            static char newName[64] = "Fixture 1 Dimmer";
            static int newDMXCh = 1;
            static int newMIDICC = 7;
            static int newMIDICh = 1;

            ImGui::TextColored(ImVec4(0, 1, 1, 1), "ADD MAPPING");
            ImGui::Spacing();
            ImGui::InputText("Name", newName, sizeof(newName));
            ImGui::InputInt("DMX Channel (1-512)", &newDMXCh);
            newDMXCh = SafeClamp(newDMXCh, 1, 512);
            ImGui::InputInt("MIDI CC", &newMIDICC);
            newMIDICC = SafeClamp(newMIDICC, 0, 127);
            ImGui::InputInt("MIDI Channel", &newMIDICh);
            newMIDICh = SafeClamp(newMIDICh, 1, 16);

            if (ImGui::Button("Add Mapping", ImVec2(140, 30))) {
                ArtNetMapping m;
                m.name = newName; m.dmxChannel = newDMXCh;
                m.midiCC = newMIDICC; m.midiChannel = newMIDICh; m.enabled = true;
                g_artnetMappings.push_back(m);
                newDMXCh++; newMIDICC++;
            }

            ImGui::Spacing();
            ImGui::TextColored(ImVec4(1, 1, 0, 1), "Quick Add - Common Fixture Types:");
            if (ImGui::Button("Dimmer")) {
                ArtNetMapping m; m.name = "Dimmer"; m.dmxChannel = 1; m.midiCC = 7; m.midiChannel = 1;
                g_artnetMappings.push_back(m);
            }
            ImGui::SameLine();
            if (ImGui::Button("R/G/B")) {
                ArtNetMapping r; r.name = "Red";   r.dmxChannel = 1; r.midiCC = 16; r.midiChannel = 1; g_artnetMappings.push_back(r);
                ArtNetMapping g; g.name = "Green"; g.dmxChannel = 2; g.midiCC = 17; g.midiChannel = 1; g_artnetMappings.push_back(g);
                ArtNetMapping b; b.name = "Blue";  b.dmxChannel = 3; b.midiCC = 18; b.midiChannel = 1; g_artnetMappings.push_back(b);
            }
            ImGui::SameLine();
            if (ImGui::Button("Moving Head (8ch)")) {
                const char* chNames[] = { "Pan","Tilt","Pan Fine","Tilt Fine","Speed","Dimmer","Strobe","Color" };
                for (int i = 0; i < 8; i++) {
                    ArtNetMapping m; m.name = chNames[i]; m.dmxChannel = i + 1; m.midiCC = 20 + i; m.midiChannel = 1;
                    g_artnetMappings.push_back(m);
                }
            }

            ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
            ImGui::Text("Active Mappings (%d):", (int)g_artnetMappings.size());
            ImGui::Spacing();

            if (ImGui::BeginTable("ArtNetMappings", 7,
                ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_ScrollY,
                ImVec2(0, 300))) {
                ImGui::TableSetupColumn("En",     ImGuiTableColumnFlags_WidthFixed, 30);
                ImGui::TableSetupColumn("Name",   ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("DMX Ch", ImGuiTableColumnFlags_WidthFixed, 60);
                ImGui::TableSetupColumn("CC",     ImGuiTableColumnFlags_WidthFixed, 50);
                ImGui::TableSetupColumn("MIDICh", ImGuiTableColumnFlags_WidthFixed, 60);
                ImGui::TableSetupColumn("Value",  ImGuiTableColumnFlags_WidthFixed, 100);
                ImGui::TableSetupColumn("Del",    ImGuiTableColumnFlags_WidthFixed, 40);
                ImGui::TableHeadersRow();

                std::vector<int> toDelete;
                for (int i = 0; i < (int)g_artnetMappings.size(); i++) {
                    auto& m = g_artnetMappings[i];
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn(); ImGui::Checkbox(("##en" + std::to_string(i)).c_str(), &m.enabled);
                    ImGui::TableNextColumn();
                    char nb[64]; strcpy_s(nb, m.name.c_str());
                    if (ImGui::InputText(("##nm" + std::to_string(i)).c_str(), nb, 64)) m.name = nb;
                    ImGui::TableNextColumn(); ImGui::Text("%d", m.dmxChannel);
                    ImGui::TableNextColumn(); ImGui::Text("CC%d", m.midiCC);
                    ImGui::TableNextColumn(); ImGui::Text("Ch%d", m.midiChannel);
                    ImGui::TableNextColumn(); ImGui::ProgressBar(m.currentValue, ImVec2(-1, 0));
                    ImGui::TableNextColumn();
                    if (ImGui::Button(("X##" + std::to_string(i)).c_str())) toDelete.push_back(i);
                }
                for (auto it = toDelete.rbegin(); it != toDelete.rend(); ++it)
                    g_artnetMappings.erase(g_artnetMappings.begin() + *it);
                ImGui::EndTable();
            }
            ImGui::EndTabItem();
        }

        ImGui::EndTabBar();
    }
    PopSubTabStyle();
}
