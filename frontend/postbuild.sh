#!/bin/bash
# 替换版本号并打包
version=$1

if [ -z "$version" ]; then
  echo "Usage: ./postbuild.sh <version>"
  exit 1
fi

cd dist
system=$(uname)
if [ "$system" == "Darwin" ]; then
  sed -i '' "s/_VERSION_/$version/g" *.js
else
  sed -i "s/_VERSION_/$version/g" *.js
fi
cd ..

chmod -R 755 dist

mv dist dist-$version 
zip -r dist-$version.zip dist-$version
echo "打包完成: dist-$version.zip"
