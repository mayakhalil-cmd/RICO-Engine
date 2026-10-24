#include "src/ui/tabs/UICommon.h"

void DrawOSC_DestinationsSubTab() {
    DrawOSCDestinationsTab();
}

void DrawOSC_MappingsSubTab() {
    DrawMappingsTab();
}

void DrawOSC_AudioRoutingSubTab() {
    ImGui::TextColored(ImVec4(1, 1, 0, 1), "Audio to OSC Routing");
    ImGui::TextDisabled("Add band mappings here: see Multimedia > Audio Analysis for the full editor.");
    ImGui::Spacing();

    if (g_audioState.capturing)
        ImGui::TextColored(ImVec4(0, 1, 0, 1), "[CAPTURING] System audio active - %d mappings active",
            (int)g_audioBandMappings.size());
    else
        ImGui::TextColored(ImVec4(1, 0.5f, 0, 1), "[STOPPED] Start audio capture in Multimedia tab first.");

    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    if (ImGui::BeginTable("OSCAudioMappingsQuick", 4,
        ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg)) {
        ImGui::TableSetupColumn("Enabled", ImGuiTableColumnFlags_WidthFixed, 60.f);
        ImGui::TableSetupColumn("Name",    ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("Band",    ImGuiTableColumnFlags_WidthFixed, 80.f);
        ImGui::TableSetupColumn("OSC Address", ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableHeadersRow();
        const char* bandLabels[] = { "LOW","MID","HIGH","OVERALL" };
        for (auto& m : g_audioBandMappings) {
            ImGui::TableNextRow();
            ImGui::TableNextColumn(); ImGui::Checkbox(("##qe_" + m.displayName).c_str(), &m.enabled);
            ImGui::TableNextColumn(); ImGui::TextUnformatted(m.displayName.c_str());
            ImGui::TableNextColumn(); ImGui::TextUnformatted(bandLabels[m.bandType < 4 ? m.bandType : 0]);
            ImGui::TableNextColumn(); ImGui::TextUnformatted(m.oscAddress.c_str());
        }
        ImGui::EndTable();
    }
}

void DrawOSCTab() {
    PushSubTabStyle();
    if (ImGui::BeginTabBar("OSCSubTabs")) {
        if (ImGui::BeginTabItem("Destinations"))  { DrawOSC_DestinationsSubTab();  ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("Mappings"))      { DrawOSC_MappingsSubTab();      ImGui::EndTabItem(); }
        if (ImGui::BeginTabItem("Audio Routing")) { DrawOSC_AudioRoutingSubTab();  ImGui::EndTabItem(); }
        ImGui::EndTabBar();
    }
    PopSubTabStyle();
}
