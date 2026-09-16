#!/bin/bash
set -ex

dnf install -y docker git
systemctl enable --now docker

mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

git clone https://github.com/GuanmingQiao/POLITEMALL-MCP.git /opt/politemall-mcp

touch /opt/politemall-mcp-bootstrap-done
