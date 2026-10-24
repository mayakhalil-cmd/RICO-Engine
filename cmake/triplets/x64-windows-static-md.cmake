# Same as vcpkg's own x64-windows-static-md, except packages are built with
# the same MSVC version Visual Studio uses for RICO (see vcpkg-toolchain.cmake).
# Mixing versions makes linking fail.
set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)

if(DEFINED ENV{RICO_MSVC_VERSION})
    set(VCPKG_PLATFORM_TOOLSET_VERSION "$ENV{RICO_MSVC_VERSION}")
endif()
