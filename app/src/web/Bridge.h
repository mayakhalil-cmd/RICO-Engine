#pragma once
#include <string>

// Connects the RICO engine to the interface in the "ui" folder.
//
// The interface talks JSON over a local WebSocket:
//   engine -> ui   {"t":"hello"}, {"t":"state"}, {"t":"live"}, {"t":"ack"}
//   ui -> engine   {"t":"cmd","id":1,"op":"midi.openIn","args":{...}}
// and sends Create workspace frames as binary messages.
//
// Everything runs on the main thread inside Bridge_Tick().

bool Bridge_Start(bool allowNetwork);
void Bridge_Stop();
void Bridge_Tick();
int  Bridge_Port();
std::string Bridge_Url();

// Set by the "settings.classic" command so the app can restart into the
// classic interface.
bool Bridge_RestartRequested();
