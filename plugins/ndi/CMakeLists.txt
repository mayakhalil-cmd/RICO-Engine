# NDI plugin. Only the NDI headers are needed to build it; the NDI runtime
# is loaded at run time from the user's own NDI Tools install.
add_library(rico-ndi SHARED rico_ndi.cpp)
target_include_directories(rico-ndi PRIVATE ndi-sdk ${CMAKE_SOURCE_DIR}/include)
set_target_properties(rico-ndi PROPERTIES
    PREFIX ""
    RUNTIME_OUTPUT_DIRECTORY ${RICO_OUT}/plugins
    RUNTIME_OUTPUT_DIRECTORY_DEBUG ${RICO_OUT}/plugins
    RUNTIME_OUTPUT_DIRECTORY_RELEASE ${RICO_OUT}/plugins
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO ${RICO_OUT}/plugins)
if(MSVC)
    target_compile_options(rico-ndi PRIVATE /W3 /utf-8)
endif()
