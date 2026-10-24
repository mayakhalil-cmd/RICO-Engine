#pragma once
#include "rico/plugin_api.h"

// Built-in OMT transport. Uses the same interface as video plugins.
const RicoPluginInfo* OmtTransportInfo();
const RicoVideoTransportApi* OmtTransportApi();
