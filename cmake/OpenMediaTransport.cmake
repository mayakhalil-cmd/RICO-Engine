# Open Media Transport runtime.
#
# RICO talks to OMT through libomt.dll, which it loads at run time. This
# downloads the official MIT licensed release once and copies the two DLLs
# next to RICO.exe. Set RICO_OMT_DIR to a folder that already has libomt.dll
# and libvmx.dll to skip the download (for offline builds).

set(RICO_OMT_VERSION "1.0.0.19" CACHE STRING "Open Media Transport release to bundle")
set(RICO_OMT_DIR "" CACHE PATH "Folder with libomt.dll and libvmx.dll (optional)")

function(rico_add_omt_runtime target)
    if(RICO_OMT_DIR)
        set(dir ${RICO_OMT_DIR})
    else()
        set(base ${CMAKE_BINARY_DIR}/_deps/omt-${RICO_OMT_VERSION})
        set(zip ${base}.zip)
        set(dir ${base}/Libraries/Winx64)
        if(NOT EXISTS ${dir}/libomt.dll)
            set(url "https://github.com/openmediatransport/libomtnet/releases/download/v${RICO_OMT_VERSION}/OpenMediaTransport.Binaries.Release.v${RICO_OMT_VERSION}.zip")
            message(STATUS "Downloading Open Media Transport ${RICO_OMT_VERSION}")
            file(DOWNLOAD ${url} ${zip} STATUS result SHOW_PROGRESS)
            list(GET result 0 code)
            if(NOT code EQUAL 0)
                message(WARNING "Could not download OMT (${result}). RICO will build, but OMT stays off "
                                "until libomt.dll and libvmx.dll are next to RICO.exe.")
                return()
            endif()
            file(ARCHIVE_EXTRACT INPUT ${zip} DESTINATION ${base})
        endif()
    endif()

    add_custom_command(TARGET ${target} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different ${dir}/libomt.dll ${dir}/libvmx.dll ${RICO_OUT}
        COMMENT "Copying the OMT runtime")
endfunction()
