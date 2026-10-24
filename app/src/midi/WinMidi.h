#pragma once
#include <string>
#include <vector>

// Windows MIDI Services support.
//
// This gives RICO virtual MIDI ports without any third-party driver. Each
// virtual port is a loopback pair: other apps see the "name" side, RICO
// listens and talks on the hidden "(RICO)" side.
//
// Needs Windows 11 with the Windows MIDI Services runtime installed.
// Everything here fails softly: if the service is missing, the functions
// return false and WinMidi_Status() says why.

bool WinMidi_IsCompiled();
bool WinMidi_Init();
void WinMidi_Shutdown();
bool WinMidi_Ready();
const char* WinMidi_Status();

// Devices (used when the MIDI backend is set to Windows MIDI Services)
std::vector<std::string> WinMidi_EndpointNames();
bool WinMidi_OpenInput(int index);
bool WinMidi_OpenOutput(int index);
void WinMidi_Send(const std::vector<unsigned char>& bytes);
void WinMidi_CloseDevices();

// Virtual ports
bool WinMidi_CreateVirtualPort(const std::string& name);
void WinMidi_RemoveVirtualPort(const std::string& name);
void WinMidi_RemoveAllVirtualPorts();
void WinMidi_SendToVirtualPorts(const std::vector<unsigned char>& bytes);
