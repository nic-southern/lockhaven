# Lockhaven vendored snapshot: keep version.h when this tree has no .git
if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/.git" AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/version.h")
	return()
endif()

# HB9HEI - required for autogen version.h
find_package(Git REQUIRED)

# Get commit hash
execute_process(COMMAND git log --format='%H' -n 1
	OUTPUT_VARIABLE GIT_COMMIT_HASH
	ERROR_QUIET)
# Check whether we got any revision (which isn't always the case, e.g. when
# someone downloaded a zip file instead of a checkout)
if ("${GIT_COMMIT_HASH}" STREQUAL "")
	set(GIT_BRANCH "N/A")
	set(GIT_COMMITS "")
	set(GIT_COMMIT_HASH "N/A")
	set(GIT_COMMIT_SHORT "N/A")
	set(GIT_DIFF "")
	set(GIT_TAG "N/A")
else()
	execute_process(COMMAND
		bash -c "git diff --quiet --exit-code || echo +"
		OUTPUT_VARIABLE GIT_DIFF)
	execute_process(COMMAND
		bash -c "git describe --always --tags |cut -f1 -d'-'"
		OUTPUT_VARIABLE GIT_TAG ERROR_QUIET)
	execute_process(COMMAND
		bash -c "git describe --always --tags |cut -f2 -d'-'"
		OUTPUT_VARIABLE GIT_COMMITS ERROR_QUIET)
	execute_process(COMMAND
		git rev-parse --abbrev-ref HEAD
		OUTPUT_VARIABLE GIT_BRANCH)
	string(STRIP "${GIT_COMMIT_HASH}" GIT_COMMIT_HASH)
	string(SUBSTRING "${GIT_COMMIT_HASH}" 1 7 GIT_COMMIT_SHORT)
	string(STRIP "${GIT_BRANCH}" GIT_BRANCH)
	string(STRIP "${GIT_COMMITS}" GIT_COMMITS)
	string(STRIP "${GIT_DIFF}" GIT_DIFF)
	string(STRIP "${GIT_TAG}" GIT_TAG)
	if (${GIT_COMMITS} STREQUAL ${GIT_TAG})
		set(GIT_COMMITS "0")
	endif()
endif()

set(VERSION "#define GIT_BRANCH \"${GIT_BRANCH}\"
#define GIT_COMMIT \"${GIT_COMMIT_SHORT}\"
#define GIT_COMMITS \"${GIT_COMMITS}\"
#define GIT_TAG \"${GIT_TAG}\"
#define VERSION \"${GIT_TAG}.r${GIT_COMMITS}.g${GIT_COMMIT_SHORT}${GIT_DIFF}\"
")

message(DEBUG "Generated Version: \"${VERSION}\"")
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/version.h)
	file(READ ${CMAKE_CURRENT_SOURCE_DIR}/version.h VERSION_)
else()
	set(VERSION_ "")
endif()
if (NOT "${VERSION}" STREQUAL "${VERSION_}")
	file(WRITE "${CMAKE_CURRENT_SOURCE_DIR}/version.h" "${VERSION}")
endif()
