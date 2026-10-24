#include "src/ui/tabs/UICommon.h"

std::string GenerateESPHomeConfig(const HWDevice& dev) {
    std::string yaml = "esphome:\n";
    yaml += "  name: " + std::string(dev.name) + "\n\n";
    yaml += "esp32:\n  board: esp32dev\n\n";
    yaml += "wifi:\n  ssid: YOUR_WIFI_SSID\n  password: YOUR_WIFI_PASSWORD\n\n";
    yaml += "mqtt:\n  broker: YOUR_BROKER_IP\n  port: 1883\n";
    yaml += "  topic_prefix: " + std::string(dev.mqttPrefix) + "\n\n";

    bool hasNeo = false;
    for (auto& p : dev.pins) if (p.type == HWPinType::NeoPixel) hasNeo = true;
    if (hasNeo) yaml += "light:\n";

    for (auto& pin : dev.pins) {
        if (!pin.enabled) continue;
        switch (pin.type) {
        case HWPinType::DigitalOut:
            yaml += "switch:\n  - platform: gpio\n    name: " + std::string(pin.name) + "\n    pin: " + std::to_string(pin.pinNumber) + "\n"; break;
        case HWPinType::PWMOut:
            yaml += "output:\n  - platform: ledc\n    pin: " + std::to_string(pin.pinNumber) + "\n    id: pwm_" + std::to_string(pin.pinNumber) + "\n"; break;
        case HWPinType::AnalogIn:
            yaml += "sensor:\n  - platform: adc\n    pin: " + std::to_string(pin.pinNumber) + "\n    name: " + std::string(pin.name) + "\n    update_interval: 100ms\n"; break;
        case HWPinType::Servo:
            yaml += "servo:\n  - id: servo_" + std::to_string(pin.pinNumber) + "\n    output: pwm_" + std::to_string(pin.pinNumber) + "\n"; break;
        case HWPinType::NeoPixel:
            yaml += "  - platform: neopixelbus\n    type: GRB\n    variant: WS2812\n    pin: " + std::to_string(pin.pinNumber) + "\n    num_leds: " + std::to_string(pin.neoPixelCount) + "\n    name: " + std::string(pin.name) + "\n"; break;
        default: break;
        }
    }
    return yaml;
}

std::string GenerateArduinoSketch(const HWDevice& dev) {
    std::string ino = "#include <WiFi.h>\n#include <PubSubClient.h>\n\n";
    ino += "const char* ssid        = \"YOUR_WIFI_SSID\";\n";
    ino += "const char* password    = \"YOUR_WIFI_PASSWORD\";\n";
    ino += "const char* mqtt_server = \"YOUR_BROKER_IP\";\n";
    ino += "const char* prefix      = \"" + std::string(dev.mqttPrefix) + "\";\n\n";
    ino += "WiFiClient   espClient;\nPubSubClient client(espClient);\n\n";
    ino += "void setupWifi() {\n  WiFi.begin(ssid, password);\n  while (WiFi.status() != WL_CONNECTED) delay(500);\n}\n\n";
    ino += "void reconnect() {\n  while (!client.connected()) {\n    if (client.connect(\"RICODevice\")) {\n";
    ino += "      client.publish((String(prefix)+\"/online\").c_str(), \"1\");\n";
    ino += "      client.publish(\"rico/announce\", (String(\"" + std::string(dev.name) + " Arduino\")).c_str());\n";
    ino += "      client.subscribe((String(prefix)+\"/pin/#\").c_str());\n    } else delay(5000);\n  }\n}\n\n";
    ino += "void setup() {\n  Serial.begin(115200);\n";
    for (auto& pin : dev.pins) {
        if (!pin.enabled) continue;
        if (pin.type == HWPinType::DigitalOut || pin.type == HWPinType::PWMOut)
            ino += "  pinMode(" + std::to_string(pin.pinNumber) + ", OUTPUT);\n";
        else if (pin.type == HWPinType::DigitalIn || pin.type == HWPinType::AnalogIn)
            ino += "  pinMode(" + std::to_string(pin.pinNumber) + ", INPUT);\n";
    }
    ino += "  setupWifi();\n  client.setServer(mqtt_server, 1883);\n";
    ino += "  client.setCallback([](char* topic, byte* payload, unsigned int len) {\n";
    ino += "    String msg; for(unsigned int i=0;i<len;i++) msg+=(char)payload[i];\n";
    for (auto& pin : dev.pins) {
        if (!pin.enabled) continue;
        std::string t = std::string(dev.mqttPrefix) + "/pin/" + std::string(pin.name);
        if (pin.type == HWPinType::DigitalOut)
            ino += "    if(String(topic)==\"" + t + "\") digitalWrite(" + std::to_string(pin.pinNumber) + ", msg.toInt());\n";
        else if (pin.type == HWPinType::PWMOut)
            ino += "    if(String(topic)==\"" + t + "\") analogWrite(" + std::to_string(pin.pinNumber) + ", (int)(msg.toFloat()*255));\n";
    }
    ino += "  });\n}\n\nvoid loop() {\n  if(!client.connected()) reconnect();\n  client.loop();\n";
    for (auto& pin : dev.pins) {
        if (!pin.enabled) continue;
        std::string t = std::string(dev.mqttPrefix) + "/pin/" + std::string(pin.name);
        if (pin.type == HWPinType::AnalogIn)
            ino += "  client.publish(\"" + t + "\", String(analogRead(" + std::to_string(pin.pinNumber) + ")/4095.0f,3).c_str());\n";
        else if (pin.type == HWPinType::DigitalIn)
            ino += "  client.publish(\"" + t + "\", String(digitalRead(" + std::to_string(pin.pinNumber) + ")).c_str());\n";
    }
    ino += "  delay(50);\n}\n";
    return ino;
}

std::string GenerateRPiScript(const HWDevice& dev) {
    std::string py = "import paho.mqtt.client as mqtt\nimport RPi.GPIO as GPIO\nimport time\n\n";
    py += "BROKER = 'YOUR_BROKER_IP'\nPREFIX = '" + std::string(dev.mqttPrefix) + "'\n\nGPIO.setmode(GPIO.BCM)\n";
    for (auto& pin : dev.pins) {
        if (!pin.enabled) continue;
        if (pin.type == HWPinType::DigitalOut || pin.type == HWPinType::PWMOut)
            py += "GPIO.setup(" + std::to_string(pin.pinNumber) + ", GPIO.OUT)\n";
        else if (pin.type == HWPinType::DigitalIn || pin.type == HWPinType::AnalogIn)
            py += "GPIO.setup(" + std::to_string(pin.pinNumber) + ", GPIO.IN)\n";
    }
    py += "\ndef on_message(client, userdata, msg):\n    payload = msg.payload.decode()\n";
    for (auto& pin : dev.pins) {
        if (!pin.enabled) continue;
        std::string t = std::string(dev.mqttPrefix) + "/set/" + std::string(pin.name);
        if (pin.type == HWPinType::DigitalOut)
            py += "    if msg.topic == '" + t + "':\n        GPIO.output(" + std::to_string(pin.pinNumber) + ", int(payload))\n";
        else if (pin.type == HWPinType::PWMOut)
            py += "    if msg.topic == '" + t + "':\n        pass  # add PWM write here\n";
    }
    py += "\nclient = mqtt.Client()\nclient.on_message = on_message\n";
    py += "client.connect(BROKER, 1883)\nclient.subscribe(PREFIX + '/set/#')\n";
    py += "client.publish(PREFIX + '/online', '1')\n";
    py += "client.publish('rico/announce', '" + std::string(dev.name) + " RPi')\n\nwhile True:\n";
    for (auto& pin : dev.pins) {
        if (!pin.enabled) continue;
        std::string t = std::string(dev.mqttPrefix) + "/pin/" + std::string(pin.name);
        if (pin.type == HWPinType::AnalogIn || pin.type == HWPinType::DigitalIn)
            py += "    client.publish('" + t + "', str(GPIO.input(" + std::to_string(pin.pinNumber) + ")))\n";
    }
    py += "    client.loop()\n    time.sleep(0.05)\n";
    return py;
}

class MQTTCallback : public virtual mqtt::callback, public virtual mqtt::iaction_listener {
public:
    void connection_lost(const std::string& cause) override {
        g_mqttState.connected = false;
        g_mqttState.status = "Connection lost: " + (cause.empty() ? "unknown" : cause);
    }
    void message_arrived(mqtt::const_message_ptr msg) override {
        std::lock_guard<std::mutex> lock(g_mqttMutex);
        MQTTMessage m;
        m.topic = msg->get_topic();
        m.payload = msg->to_string();
        m.timestamp = (float)std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
        g_mqttLog.insert(g_mqttLog.begin(), m);
        if ((int)g_mqttLog.size() > g_mqttLogMax) g_mqttLog.resize(g_mqttLogMax);

        for (auto& sub : g_mqttSubscriptions) {
            if (!sub.enabled || !sub.triggerSequence) continue;
            if (sub.targetSequenceIdx < 0 || sub.targetSequenceIdx >= (int)g_sequences.size()) continue;
            bool topicMatch = (m.topic == sub.topic) || (std::string(sub.topic) == "#") ||
                (std::string(sub.topic).back() == '#' && m.topic.find(std::string(sub.topic, strlen(sub.topic) - 1)) == 0);
            bool payloadMatch = strlen(sub.triggerPayload) == 0 || m.payload == sub.triggerPayload;
            if (topicMatch && payloadMatch) {
                auto& seq = g_sequences[sub.targetSequenceIdx];
                seq.running = true; seq.paused = false; seq.elapsed = 0.0f;
                seq.pausedDuration = 0.0f; seq.loopCount = 0;
                seq.startTime = std::chrono::steady_clock::now();
            }
        }

        if (m.topic.find("rico/announce") != std::string::npos) {
            bool known = false;
            for (auto& d : g_hwDevices)
                if (std::string(d.mqttPrefix) == m.topic.substr(0, m.topic.rfind('/'))) known = true;
            for (auto& d : g_hwPendingDevices)
                if (d.name == m.payload) known = true;
            if (!known) {
                HWDevice newDev;
                strncpy_s(newDev.name, m.payload.c_str(), sizeof(newDev.name));
                newDev.pendingApproval = true;
                if (m.payload.find("ESP32") != std::string::npos)          newDev.type = HWDeviceType::ESP32;
                else if (m.payload.find("Arduino") != std::string::npos)   newDev.type = HWDeviceType::Arduino;
                else if (m.payload.find("RPi") != std::string::npos ||
                         m.payload.find("Raspberry") != std::string::npos) newDev.type = HWDeviceType::RaspberryPi;
                g_hwPendingDevices.push_back(newDev);
                g_hwNewDeviceNotification = true;
            }
        }

        for (auto& d : g_hwDevices) {
            std::string onlineTopic = std::string(d.mqttPrefix) + "/online";
            if (m.topic == onlineTopic) {
                d.online = (m.payload == "1" || m.payload == "true" || m.payload == "online");
                d.lastSeen = m.timestamp;
            }
            if (m.topic.find(std::string(d.mqttPrefix) + "/pin/") != std::string::npos) {
                std::string pinName = m.topic.substr(m.topic.rfind('/') + 1);
                for (auto& pin : d.pins) {
                    if (std::string(pin.name) != pinName) continue;
                    try { pin.currentValue = std::stof(m.payload); } catch (...) {}
                    if (pin.routeType == 1) { SetDMXChannel(pin.routeDMXCh, pin.currentValue); if (g_artnetState.initialized) SendArtNetDMX(); }
                    else if (pin.routeType == 2 && g_midiOut && g_midiOut->isPortOpen()) {
                        int val = (int)(pin.currentValue * 127.0f);
                        std::vector<unsigned char> msg2 = { (unsigned char)(0xB0 + pin.routeMIDICh - 1), (unsigned char)pin.routeMIDICC, (unsigned char)val };
                        g_midiOut->sendMessage(&msg2);
                    }
                    else if (pin.routeType == 4 && pin.routeSeqIdx >= 0 && pin.routeSeqIdx < (int)g_sequences.size()) {
                        if (pin.currentValue > 0.5f) {
                            auto& seq = g_sequences[pin.routeSeqIdx];
                            seq.running = true; seq.paused = false; seq.elapsed = 0.0f; seq.pausedDuration = 0.0f;
                            seq.startTime = std::chrono::steady_clock::now();
                        }
                    }
                }
            }
        }
    }
    void delivery_complete(mqtt::delivery_token_ptr tok) override {}
    void on_failure(const mqtt::token& tok) override { g_mqttState.connected = false; g_mqttState.connecting = false; g_mqttState.status = "Connection failed"; }
    void on_success(const mqtt::token& tok) override {}
};

static MQTTCallback g_mqttCallback;

bool MQTTConnect() {
    if (g_mqttClient) { try { g_mqttClient->disconnect()->wait(); } catch (...) {} delete g_mqttClient; g_mqttClient = nullptr; }
    try {
        g_mqttClient = new mqtt::async_client(g_mqttState.broker, g_mqttState.clientID);
        g_mqttClient->set_callback(g_mqttCallback);
        mqtt::connect_options opts;
        opts.set_keep_alive_interval(20);
        opts.set_clean_session(true);
        if (strlen(g_mqttState.username) > 0) { opts.set_user_name(g_mqttState.username); opts.set_password(g_mqttState.password); }
        g_mqttState.connecting = true;
        g_mqttState.status = "Connecting...";
        g_mqttClient->connect(opts)->wait();
        g_mqttState.connected = true;
        g_mqttState.connecting = false;
        g_mqttState.status = std::string("Connected to ") + g_mqttState.broker;
        for (auto& sub : g_mqttSubscriptions) if (sub.enabled) g_mqttClient->subscribe(sub.topic, sub.qos)->wait();
        return true;
    }
    catch (const mqtt::exception& e) {
        g_mqttState.connected = false; g_mqttState.connecting = false;
        g_mqttState.status = std::string("Error: ") + e.what();
        return false;
    }
}

void MQTTDisconnect() {
    if (g_mqttClient) { try { g_mqttClient->disconnect()->wait(); } catch (...) {} delete g_mqttClient; g_mqttClient = nullptr; }
    g_mqttState.connected = false;
    g_mqttState.status = "Disconnected";
}

void MQTTPublish(const char* topic, const char* payload, int qos, bool retain) {
    if (!g_mqttClient || !g_mqttState.connected) return;
    try { auto msg = mqtt::make_message(topic, payload); msg->set_qos(qos); msg->set_retained(retain); g_mqttClient->publish(msg); }
    catch (...) {}
}

void DrawMQTTTab() {
    PushSubTabStyle();
    if (ImGui::BeginTabBar("MQTTSubTabs")) {

        if (ImGui::BeginTabItem("Connection")) {
            ImGui::TextColored(ImVec4(0,1,1,1), "BROKER"); ImGui::Spacing();
            ImGui::InputText("Broker URL", g_mqttState.broker, sizeof(g_mqttState.broker));
            ImGui::SameLine(); ImGui::TextDisabled("tcp://host:1883  or  ssl://host:8883");
            ImGui::InputText("Client ID", g_mqttState.clientID, sizeof(g_mqttState.clientID));
            ImGui::InputText("Username",  g_mqttState.username, sizeof(g_mqttState.username));
            ImGui::InputText("Password",  g_mqttState.password, sizeof(g_mqttState.password), ImGuiInputTextFlags_Password);
            ImGui::Spacing();
            if (!g_mqttState.connected && !g_mqttState.connecting) {
                if (ImGui::Button("Connect", ImVec2(160, 35))) MQTTConnect();
            } else if (g_mqttState.connecting) {
                ImGui::TextColored(ImVec4(1,1,0,1), "[CONNECTING...]");
            } else {
                ImGui::TextColored(ImVec4(0,1,0,1), "[OK] %s", g_mqttState.status.c_str());
                if (ImGui::Button("Disconnect", ImVec2(160, 30))) MQTTDisconnect();
            }
            if (!g_mqttState.connected && !g_mqttState.connecting && !g_mqttState.status.empty() &&
                g_mqttState.status != "Not connected" && g_mqttState.status != "Disconnected") {
                ImGui::Spacing();
                ImGui::TextColored(ImVec4(1,0.4f,0.4f,1), "%s", g_mqttState.status.c_str());
            }
            ImGui::Spacing(); ImGui::Separator();
            ImGui::TextColored(ImVec4(0,1,1,1), "QUICK TEST"); ImGui::Spacing();
            static char testTopic[128] = "/rico/test";
            static char testPayload[256] = "hello from RICO";
            ImGui::SetNextItemWidth(200); ImGui::InputText("Topic##test", testTopic, sizeof(testTopic)); ImGui::SameLine();
            ImGui::SetNextItemWidth(200); ImGui::InputText("Payload##test", testPayload, sizeof(testPayload)); ImGui::SameLine();
            if (ImGui::Button("Send##test", ImVec2(80,0))) MQTTPublish(testTopic, testPayload);
            ImGui::Spacing(); ImGui::Separator();
            ImGui::TextColored(ImVec4(0,1,1,1), "MESSAGE LOG (last 100)"); ImGui::Spacing();
            if (ImGui::BeginTable("MQTTLog", 3, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_ScrollY, ImVec2(0,200))) {
                ImGui::TableSetupColumn("Topic",   ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("Payload", ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("Age(s)",  ImGuiTableColumnFlags_WidthFixed, 60);
                ImGui::TableHeadersRow();
                float nowSec = (float)std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
                std::lock_guard<std::mutex> lock(g_mqttMutex);
                for (auto& m : g_mqttLog) {
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn(); ImGui::TextUnformatted(m.topic.c_str());
                    ImGui::TableNextColumn(); ImGui::TextUnformatted(m.payload.c_str());
                    ImGui::TableNextColumn(); ImGui::Text("%.1f", nowSec - m.timestamp);
                }
                ImGui::EndTable();
            }
            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Publish")) {
            ImGui::TextColored(ImVec4(0,1,1,1), "PUBLISH PRESETS"); ImGui::Spacing();
            static MQTTPublishPreset newPreset;
            ImGui::SetNextItemWidth(100); ImGui::InputText("##pname",    newPreset.name,    sizeof(newPreset.name));    ImGui::SameLine();
            ImGui::SetNextItemWidth(150); ImGui::InputText("##ptopic",   newPreset.topic,   sizeof(newPreset.topic));   ImGui::SameLine();
            ImGui::SetNextItemWidth(150); ImGui::InputText("##ppayload", newPreset.payload, sizeof(newPreset.payload)); ImGui::SameLine();
            if (ImGui::Button("+ Add", ImVec2(70,0))) g_mqttPresets.push_back(newPreset);
            ImGui::Spacing();
            if (ImGui::BeginTable("PublishPresets", 6, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg)) {
                ImGui::TableSetupColumn("Name",    ImGuiTableColumnFlags_WidthFixed, 100);
                ImGui::TableSetupColumn("Topic",   ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("Payload", ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("QoS",     ImGuiTableColumnFlags_WidthFixed, 40);
                ImGui::TableSetupColumn("Send",    ImGuiTableColumnFlags_WidthFixed, 60);
                ImGui::TableSetupColumn("Del",     ImGuiTableColumnFlags_WidthFixed, 30);
                ImGui::TableHeadersRow();
                std::vector<int> toDelete;
                for (int i = 0; i < (int)g_mqttPresets.size(); i++) {
                    auto& p = g_mqttPresets[i];
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::InputText(("##pn"+std::to_string(i)).c_str(), p.name,    sizeof(p.name));
                    ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::InputText(("##pt"+std::to_string(i)).c_str(), p.topic,   sizeof(p.topic));
                    ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::InputText(("##pp"+std::to_string(i)).c_str(), p.payload, sizeof(p.payload));
                    ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::InputInt(("##pq"+std::to_string(i)).c_str(), &p.qos, 0, 0); p.qos = SafeClamp(p.qos, 0, 2);
                    ImGui::TableNextColumn(); if (ImGui::Button(("Send##ps"+std::to_string(i)).c_str())) MQTTPublish(p.topic, p.payload, p.qos, p.retain);
                    ImGui::TableNextColumn(); if (ImGui::Button(("X##pd"+std::to_string(i)).c_str()))    toDelete.push_back(i);
                }
                for (auto it = toDelete.rbegin(); it != toDelete.rend(); ++it) g_mqttPresets.erase(g_mqttPresets.begin() + *it);
                ImGui::EndTable();
            }
            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Subscribe")) {
            ImGui::TextColored(ImVec4(0,1,1,1), "SUBSCRIPTIONS"); ImGui::Spacing();
            static MQTTSubscription newSub;
            ImGui::SetNextItemWidth(200); ImGui::InputText("Topic##newsub", newSub.topic, sizeof(newSub.topic)); ImGui::SameLine();
            if (ImGui::Button("+ Subscribe", ImVec2(110,0))) {
                if (g_mqttState.connected) g_mqttClient->subscribe(newSub.topic, newSub.qos);
                g_mqttSubscriptions.push_back(newSub);
            }
            ImGui::SameLine(); ImGui::TextDisabled("# = all,  /rico/# = rico subtopics only");
            ImGui::Spacing();
            if (ImGui::BeginTable("SubTable", 5, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg)) {
                ImGui::TableSetupColumn("En",             ImGuiTableColumnFlags_WidthFixed, 25);
                ImGui::TableSetupColumn("Topic",          ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("Trigger Seq",    ImGuiTableColumnFlags_WidthFixed, 220);
                ImGui::TableSetupColumn("Payload Match",  ImGuiTableColumnFlags_WidthFixed, 120);
                ImGui::TableSetupColumn("Del",            ImGuiTableColumnFlags_WidthFixed, 30);
                ImGui::TableHeadersRow();
                std::vector<int> toDelete;
                for (int i = 0; i < (int)g_mqttSubscriptions.size(); i++) {
                    auto& s = g_mqttSubscriptions[i];
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn(); ImGui::Checkbox(("##sen"+std::to_string(i)).c_str(), &s.enabled);
                    ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::InputText(("##st"+std::to_string(i)).c_str(), s.topic, sizeof(s.topic));
                    ImGui::TableNextColumn();
                    ImGui::Checkbox(("Trigger##strig"+std::to_string(i)).c_str(), &s.triggerSequence);
                    if (s.triggerSequence) {
                        ImGui::SameLine(); ImGui::SetNextItemWidth(100);
                        std::vector<const char*> seqNames; seqNames.push_back("(none)");
                        for (auto& sq : g_sequences) seqNames.push_back(sq.name);
                        int idx = s.targetSequenceIdx + 1;
                        if (ImGui::Combo(("##sseq"+std::to_string(i)).c_str(), &idx, seqNames.data(), (int)seqNames.size()))
                            s.targetSequenceIdx = idx - 1;
                    }
                    ImGui::TableNextColumn(); ImGui::SetNextItemWidth(-1); ImGui::InputText(("##spm"+std::to_string(i)).c_str(), s.triggerPayload, sizeof(s.triggerPayload));
                    ImGui::TableNextColumn(); if (ImGui::Button(("X##sd"+std::to_string(i)).c_str())) toDelete.push_back(i);
                }
                for (auto it = toDelete.rbegin(); it != toDelete.rend(); ++it) g_mqttSubscriptions.erase(g_mqttSubscriptions.begin() + *it);
                ImGui::EndTable();
            }
            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Hardware")) {
            if (!g_hwPendingDevices.empty()) {
                ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.3f,0.2f,0,0.8f));
                ImGui::BeginChild("PendingBanner", ImVec2(-1,60), true);
                ImGui::TextColored(ImVec4(1,1,0,1), "! %d new device(s) detected - awaiting approval", (int)g_hwPendingDevices.size());
                ImGui::Spacing();
                for (int i = 0; i < (int)g_hwPendingDevices.size(); i++) {
                    auto& pd = g_hwPendingDevices[i];
                    ImGui::Text("%s", pd.name); ImGui::SameLine();
                    if (ImGui::Button(("Approve##ap"+std::to_string(i)).c_str())) { g_hwDevices.push_back(pd); g_hwPendingDevices.erase(g_hwPendingDevices.begin()+i); i--; }
                    ImGui::SameLine();
                    if (ImGui::Button(("Ignore##ig"+std::to_string(i)).c_str()))  { g_hwPendingDevices.erase(g_hwPendingDevices.begin()+i); i--; }
                }
                ImGui::EndChild(); ImGui::PopStyleColor(); ImGui::Spacing();
            }

            ImGui::TextColored(ImVec4(0,1,1,1), "ADD DEVICE"); ImGui::Spacing();
            static HWDevice newDev;
            static const char* devTypes[] = { "ESP32","Arduino","Raspberry Pi","Custom" };
            ImGui::SetNextItemWidth(150); ImGui::InputText("Name##hwname", newDev.name, sizeof(newDev.name)); ImGui::SameLine();
            ImGui::SetNextItemWidth(100);
            int dt = (int)newDev.type;
            if (ImGui::Combo("Type##hwtype", &dt, devTypes, 4)) newDev.type = (HWDeviceType)dt;
            ImGui::SameLine();
            ImGui::SetNextItemWidth(150); ImGui::InputText("MQTT Prefix##hwpfx", newDev.mqttPrefix, sizeof(newDev.mqttPrefix)); ImGui::SameLine();
            if (ImGui::Button("Add Device", ImVec2(100,0))) g_hwDevices.push_back(newDev);

            ImGui::Spacing(); ImGui::Separator();
            ImGui::TextColored(ImVec4(0,1,1,1), "DEVICES (%d)", (int)g_hwDevices.size()); ImGui::Spacing();

            std::vector<int> toDeleteDev;
            for (int di = 0; di < (int)g_hwDevices.size(); di++) {
                auto& dev = g_hwDevices[di];
                static const char* pinTypes[] = { "Digital Out","PWM Out","Analog In","Servo","NeoPixel","I2C","Serial","Digital In" };
                ImVec4 cardColor = dev.online ? ImVec4(0,0.15f,0,0.6f) : ImVec4(0.1f,0.1f,0.1f,0.6f);
                ImGui::PushStyleColor(ImGuiCol_ChildBg, cardColor);
                float cardH = dev.showPins ? 120.f + dev.pins.size() * 28.f : 90.f;
                ImGui::BeginChild(("hwcard"+std::to_string(di)).c_str(), ImVec2(-1, cardH), true);

                ImGui::TextColored(dev.online ? ImVec4(0,1,0,1) : ImVec4(0.5f,0.5f,0.5f,1), dev.online ? "[ONLINE]" : "[OFFLINE]");
                ImGui::SameLine(); ImGui::Text("%s", dev.name);
                ImGui::SameLine(); ImGui::TextDisabled("(%s) prefix: %s", devTypes[(int)dev.type], dev.mqttPrefix);
                ImGui::SameLine(ImGui::GetContentRegionAvail().x - 200);
                if (ImGui::SmallButton(("Ping##"+std::to_string(di)).c_str())) { std::string t = std::string(dev.mqttPrefix)+"/ping"; MQTTPublish(t.c_str(), "1"); }
                ImGui::SameLine();
                if (ImGui::SmallButton(dev.showPins ? "Hide Pins" : "Show Pins")) dev.showPins = !dev.showPins;
                ImGui::SameLine();
                if (ImGui::SmallButton(("Del##"+std::to_string(di)).c_str())) toDeleteDev.push_back(di);

                ImGui::Spacing();
                static HWPin newPin;
                ImGui::SetNextItemWidth(80); ImGui::InputText(("##pname"+std::to_string(di)).c_str(), newPin.name, sizeof(newPin.name)); ImGui::SameLine();
                ImGui::SetNextItemWidth(40); ImGui::InputInt(("Pin##"+std::to_string(di)).c_str(), &newPin.pinNumber, 0, 0); ImGui::SameLine();
                ImGui::SetNextItemWidth(90);
                int pt = (int)newPin.type;
                if (ImGui::Combo(("##pt"+std::to_string(di)).c_str(), &pt, pinTypes, 8)) newPin.type = (HWPinType)pt;
                ImGui::SameLine();
                if (ImGui::SmallButton(("+ Pin##"+std::to_string(di)).c_str())) { sprintf_s(newPin.mqttTopic, "%s/pin/%s", dev.mqttPrefix, newPin.name); dev.pins.push_back(newPin); dev.showPins = true; }

                if (dev.showPins) {
                    ImGui::Spacing(); ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
                    ImVec4 ptColor[] = { ImVec4(0,1,0,1),ImVec4(0.5f,1,0,1),ImVec4(1,0.5f,0,1),ImVec4(0,0.8f,1,1),ImVec4(1,0,1,1),ImVec4(0.5f,0.5f,1,1),ImVec4(1,1,0,1),ImVec4(0,1,0.5f,1) };
                    for (int pi = 0; pi < (int)dev.pins.size(); pi++) {
                        auto& pin = dev.pins[pi];
                        ImGui::PushID(pi + di * 100);
                        ImGui::TextColored(ptColor[(int)pin.type], "[%s]", pinTypes[(int)pin.type]);
                        ImGui::SameLine(); ImGui::Text("D%d %s", pin.pinNumber, pin.name); ImGui::SameLine();
                        switch (pin.type) {
                        case HWPinType::DigitalOut: { bool v = pin.currentValue > 0.5f; if (ImGui::Checkbox("##dout", &v)) { pin.currentValue = v?1.f:0.f; MQTTPublish(pin.mqttTopic, v?"1":"0"); } break; }
                        case HWPinType::PWMOut: case HWPinType::Servo:
                            ImGui::SetNextItemWidth(120);
                            if (ImGui::SliderFloat("##pwm", &pin.currentValue, 0.f, 1.f, "%.2f")) { char buf[16]; sprintf_s(buf,"%.3f",pin.currentValue); MQTTPublish(pin.mqttTopic, buf); }
                            break;
                        case HWPinType::AnalogIn: case HWPinType::DigitalIn:
                            ImGui::ProgressBar(pin.currentValue, ImVec2(120,14)); ImGui::SameLine(); ImGui::Text("%.3f", pin.currentValue); break;
                        case HWPinType::NeoPixel: {
                            static ImVec4 neoColor = ImVec4(1,1,1,1);
                            if (ImGui::ColorEdit3(("##neo"+std::to_string(pi)).c_str(), (float*)&neoColor, ImGuiColorEditFlags_NoInputs)) {
                                char buf[32]; sprintf_s(buf,"%d,%d,%d",(int)(neoColor.x*255),(int)(neoColor.y*255),(int)(neoColor.z*255)); MQTTPublish(pin.mqttTopic, buf);
                            } break; }
                        default: ImGui::TextDisabled("topic: %s", pin.mqttTopic); break;
                        }
                        ImGui::SameLine();
                        const char* routeTypes[] = { "None","DMX","MIDI","OSC","Sequence" };
                        ImGui::SetNextItemWidth(80); ImGui::Combo(("##route"+std::to_string(pi)).c_str(), &pin.routeType, routeTypes, 5);
                        if (pin.routeType == 1) { ImGui::SameLine(); ImGui::SetNextItemWidth(50); ImGui::InputInt(("CH##"+std::to_string(pi)).c_str(), &pin.routeDMXCh, 0, 0); }
                        else if (pin.routeType == 2) { ImGui::SameLine(); ImGui::SetNextItemWidth(45); ImGui::InputInt(("CC##"+std::to_string(pi)).c_str(), &pin.routeMIDICC, 0, 0); }
                        else if (pin.routeType == 4) {
                            ImGui::SameLine(); ImGui::SetNextItemWidth(100);
                            std::vector<const char*> seqNames; seqNames.push_back("(none)");
                            for (auto& sq : g_sequences) seqNames.push_back(sq.name);
                            ImGui::Combo(("##seqr"+std::to_string(pi)).c_str(), &pin.routeSeqIdx, seqNames.data(), (int)seqNames.size());
                        }
                        ImGui::SameLine();
                        if (ImGui::SmallButton(("X##pdel"+std::to_string(pi)).c_str())) dev.pins.erase(dev.pins.begin()+pi--);
                        ImGui::PopID();
                    }
                }
                ImGui::EndChild(); ImGui::PopStyleColor(); ImGui::Spacing();
            }
            for (auto it = toDeleteDev.rbegin(); it != toDeleteDev.rend(); ++it) g_hwDevices.erase(g_hwDevices.begin() + *it);
            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Config Generator")) {
            ImGui::TextColored(ImVec4(0,1,1,1), "GENERATE FIRMWARE / SCRIPTS"); ImGui::Spacing();
            ImGui::TextDisabled("Select a device then generate ready-to-flash code"); ImGui::Spacing();
            if (g_hwDevices.empty()) { ImGui::TextDisabled("Add devices in the Hardware tab first"); }
            else {
                static int genDevIdx = 0;
                static const char* devTypes[] = { "ESP32","Arduino","Raspberry Pi","Custom" };
                std::vector<const char*> devNames;
                for (auto& d : g_hwDevices) devNames.push_back(d.name);
                ImGui::SetNextItemWidth(200); ImGui::Combo("Device##gen", &genDevIdx, devNames.data(), (int)devNames.size());
                ImGui::Spacing();
                auto& dev = g_hwDevices[genDevIdx];
                static std::string generatedConfig, configType;
                if (dev.type == HWDeviceType::ESP32) {
                    if (ImGui::Button("Generate ESPHome YAML", ImVec2(200,35))) { generatedConfig = GenerateESPHomeConfig(dev); configType = "ESPHome (.yaml)"; }
                    ImGui::SameLine(); ImGui::TextDisabled("Flash via ESPHome dashboard");
                }
                if (dev.type == HWDeviceType::ESP32 || dev.type == HWDeviceType::Arduino) {
                    if (ImGui::Button("Generate Arduino Sketch", ImVec2(200,35))) { generatedConfig = GenerateArduinoSketch(dev); configType = "Arduino (.ino)"; }
                    ImGui::SameLine(); ImGui::TextDisabled("Open in Arduino IDE and flash");
                }
                if (dev.type == HWDeviceType::RaspberryPi) {
                    if (ImGui::Button("Generate Python Script", ImVec2(200,35))) { generatedConfig = GenerateRPiScript(dev); configType = "Python (.py)"; }
                    ImGui::SameLine(); ImGui::TextDisabled("Run with: python3 rico_device.py");
                }
                if (!generatedConfig.empty()) {
                    ImGui::Spacing(); ImGui::TextColored(ImVec4(0,1,0,1), "[OK] Generated: %s", configType.c_str()); ImGui::Spacing();
                    if (ImGui::Button("Save to File", ImVec2(130,30))) {
                        std::string ext = configType.find("yaml") != std::string::npos ? ".yaml" : configType.find("Python") != std::string::npos ? ".py" : ".ino";
                        std::ofstream f("rico_" + std::string(dev.name) + ext);
                        if (f) { f << generatedConfig; f.close(); }
                    }
                    ImGui::SameLine();
                    if (ImGui::Button("Copy to Clipboard", ImVec2(150,30))) ImGui::SetClipboardText(generatedConfig.c_str());
                    ImGui::Spacing();
                    ImGui::InputTextMultiline("##genout", (char*)generatedConfig.c_str(), generatedConfig.size()+1, ImVec2(-1,400), ImGuiInputTextFlags_ReadOnly);
                }
            }
            ImGui::EndTabItem();
        }

        ImGui::EndTabBar();
    }
    PopSubTabStyle();
}
