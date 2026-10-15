# syntax=docker/dockerfile:1
# A Dot's computer (ticket 172, PLAN.md D7): a desktop the agent drives with
# xdotool and screenshots, and a person watches (or takes over) through
# noVNC on port 6080. OSS only, multi-arch (amd64 and arm64):
#   docker build -t sandbox-desktop:latest apps/sandbox-runner/desktop
# The runner starts it with the same hardening as every sandbox: non-root
# (1000:1000), read-only root, every capability dropped, /tmp and $HOME on
# tmpfs and /work on the sandbox's own volume, where Chromium keeps its
# profile so sign-ins survive restarts.

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash ca-certificates coreutils curl procps \
    xvfb x11vnc openbox xdotool scrot imagemagick x11-utils \
    novnc python3-websockify \
    chromium fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 1000 sandbox \
  && useradd -u 1000 -g 1000 -d /home/sandbox -s /bin/bash sandbox \
  && mkdir -p /work && chown 1000:1000 /work
COPY desktop-session open-browser /usr/local/bin/
COPY index.html /usr/share/novnc/index.html
ENV DISPLAY=:1 HOME=/home/sandbox
USER 1000:1000
WORKDIR /work
EXPOSE 6080
CMD ["desktop-session"]
