#include "src/ui/tabs/UICommon.h"

void DrawAbletonLinkTab() {
    if (ImGui::BeginTabBar("LinkSubTabs")) {
        if (ImGui::BeginTabItem("Sync")) {
            ImGui::TextColored(ImVec4(1, 1, 0, 1), "Ableton Link: Coming Soon");
            ImGui::TextDisabled("Tempo and beat sync across Link-enabled applications on the same network.");
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem("Timeline")) {
            ImGui::TextDisabled("Trigger OSC/MIDI events locked to Link transport position.");
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }
}
