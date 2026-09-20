#!/bin/bash
VERSION=${1:-"0.1.0"}
export BUILD_VERSION=$VERSION
./prebuild.sh
npx vite build
./postbuild.sh $VERSION
