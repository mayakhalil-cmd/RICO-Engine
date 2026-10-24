// Starter code for the hardware in Output > Outputs. Short on purpose: each
// one receives what RICO sends and does one clear thing with it.

export const HARDWARE_CODE: Record<string, { title: string; file: string; how: string; code: string }> = {
  wled: {
    title: 'WLED', file: 'wled.txt',
    how: 'Flash WLED from install.wled.me, join it to your Wi-Fi, set the LED count in Config > LED Preferences, and type its address here. DDP works without any setting.',
    code: `1. Open install.wled.me in Chrome, plug in the ESP32 or ESP8266 and press Install.
2. Join the "WLED-AP" Wi-Fi, pick your own Wi-Fi network, and note the address it gets.
3. Config > LED Preferences: set the LED count and the data pin (GPIO 16 on most ESP32 boards).
4. In RICO: type that address, set the same LED count, switch the output on.
WLED shows RICO's colors as soon as they arrive and goes back to its own effects a few seconds after they stop.`,
  },
  adalight: {
    title: 'Arduino, ESP32 or Pico with FastLED (USB)', file: 'rico_adalight.ino',
    how: 'Install the FastLED library, set your pin and LED count, upload, then pick the COM port here. Use the same speed (115200) on both sides.',
    code: `// RICO LED strip over USB (Adalight). Needs the FastLED library.
#include <FastLED.h>

#define NUM_LEDS 60          // the same count as in RICO
#define DATA_PIN 6           // the pin the strip's data wire is on
#define SPEED 115200

CRGB leds[NUM_LEDS];

void setup() {
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  Serial.begin(SPEED);
  Serial.print("Ada\\n");    // says hello, some tools wait for it
}

uint8_t readByte() {
  while (!Serial.available()) {}
  return Serial.read();
}

void loop() {
  // wait for "Ada", then the LED count and a checksum
  if (readByte() != 'A') return;
  if (readByte() != 'd') return;
  if (readByte() != 'a') return;
  uint8_t hi = readByte(), lo = readByte(), check = readByte();
  if (check != (hi ^ lo ^ 0x55)) return;
  int count = min((hi << 8 | lo) + 1, NUM_LEDS);
  for (int i = 0; i < count; i++) {
    // RICO already sends the colors in the strip's order
    uint8_t a = readByte(), b = readByte(), c = readByte();
    leds[i].raw[0] = a; leds[i].raw[1] = b; leds[i].raw[2] = c;
  }
  FastLED.show();
}
`,
  },
  'pi-leds': {
    title: 'Raspberry Pi LED strip (Python)', file: 'rico_leds.py',
    how: 'On the Pi: sudo pip3 install rpi_ws281x --break-system-packages, wire the strip data to GPIO 18, then sudo python3 rico_leds.py. Type the Pi\'s address here, port 7000.',
    code: `# RICO LED strip on a Raspberry Pi. Run with: sudo python3 rico_leds.py
import socket
from rpi_ws281x import PixelStrip

NUM_LEDS = 60        # the same count as in RICO
PIN = 18             # GPIO 18 (pin 12)
PORT = 7000

strip = PixelStrip(NUM_LEDS, PIN, brightness=255)
strip.begin()
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", PORT))
print("Waiting for RICO on port", PORT)

while True:
    data, _ = sock.recvfrom(65535)
    # three bytes per LED; RICO sends them in the order you picked (RGB)
    for i in range(min(NUM_LEDS, len(data) // 3)):
        r, g, b = data[i * 3], data[i * 3 + 1], data[i * 3 + 2]
        strip.setPixelColorRGB(i, r, g, b)
    strip.show()
`,
  },
  'pi-osc': {
    title: 'Raspberry Pi with OSC (Python)', file: 'rico_osc.py',
    how: 'On the Pi: pip3 install python-osc gpiozero --break-system-packages, then python3 rico_osc.py. Type the Pi\'s address here, port 9000. Every signal arrives as /rico/<name> with a value from 0 to 1.',
    code: `# RICO values on a Raspberry Pi: a dimmable LED, a servo and a relay.
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import BlockingOSCUDPServer
from gpiozero import PWMLED, Servo, OutputDevice

led = PWMLED(17)        # GPIO 17, through a resistor
servo = Servo(18)       # GPIO 18
relay = OutputDevice(27)

def on_value(address, value):
    name = address.split("/")[-1]
    print(name, round(value, 3))
    if name == "fader1":
        led.value = max(0.0, min(1.0, value))
    elif name == "knob1":
        servo.value = value * 2 - 1          # 0..1 to -1..1
    elif name == "button1":
        relay.on() if value > 0.5 else relay.off()

d = Dispatcher()
d.map("/rico/*", on_value)
print("Waiting for RICO on port 9000")
BlockingOSCUDPServer(("0.0.0.0", 9000), d).serve_forever()
`,
  },
  'mcu-serial': {
    title: 'Microcontroller reading values (USB)', file: 'rico_values.ino',
    how: 'Upload, then pick the COM port here at 115200. Each line looks like "fader1:0.42".',
    code: `// RICO values over USB: lines like "fader1:0.42".
#include <Servo.h>

Servo servo;
const int LED_PIN = 9;       // a PWM pin

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  servo.attach(10);
}

void loop() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\\n');
  int colon = line.indexOf(':');
  if (colon < 0) return;
  String name = line.substring(0, colon);
  float value = line.substring(colon + 1).toFloat();   // 0 to 1
  if (name == "fader1") analogWrite(LED_PIN, (int)(value * 255));
  if (name == "knob1") servo.write((int)(value * 180));
}
`,
  },
  'esp-udp': {
    title: 'ESP32 or Pico W on Wi-Fi (UDP)', file: 'rico_wifi.ino',
    how: 'Put in your Wi-Fi name and password, upload, open the serial monitor to see its address, and type it here (port 7001).',
    code: `// RICO values over Wi-Fi to an ESP32: lines like "fader1:0.42".
#include <WiFi.h>
#include <WiFiUdp.h>

const char* WIFI = "your-wifi";
const char* PASS = "your-password";
const int PORT = 7001;
const int LED_PIN = 2;

WiFiUDP udp;
char buf[512];

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI, PASS);
  while (WiFi.status() != WL_CONNECTED) delay(200);
  Serial.print("Type this in RICO: ");
  Serial.println(WiFi.localIP());
  udp.begin(PORT);
  ledcAttach(LED_PIN, 5000, 8);
}

void loop() {
  int n = udp.parsePacket();
  if (!n) return;
  n = udp.read(buf, sizeof(buf) - 1);
  buf[n] = 0;
  // one value per line
  for (char* line = strtok(buf, "\\n"); line; line = strtok(nullptr, "\\n")) {
    char* colon = strchr(line, ':');
    if (!colon) continue;
    *colon = 0;
    float value = atof(colon + 1);
    if (strcmp(line, "fader1") == 0) ledcWrite(LED_PIN, (int)(value * 255));
  }
}
`,
  },
}
