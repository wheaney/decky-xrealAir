#!/bin/bash
set -e

pacman -S --noconfirm git jq

git clone https://github.com/wheaney/decky-xrealAir

# this branch represents an older version of the plugin on a deprecation path, force this to build on an older commit
pushd decky-xrealAir
git checkout tags/v0.5.6-beta
popd

# iterate over the custom_remote_binary list in package.json, download and check hashes, and finally copy if matching
jq -r '.custom_remote_binary[] | "\(.name) \(.sha256hash) \(.url)"' decky-xrealAir/package.json | while read name hash url; do
    curl -Ls "$url" -o "/tmp/$name"
    computed_hash=$(sha256sum "/tmp/$name" | cut -d ' ' -f 1)
    if [ "$computed_hash" == "$hash" ]; then
        echo "Remote binary checksum passed: ${url}"
        mv "/tmp/$name" "/backend/out/$name"
    else
        echo "Remote binary checksum failed: ${url}\ncomputed: ${computed_hash}\nexpected: ${hash}"
        exit 1
    fi
done
