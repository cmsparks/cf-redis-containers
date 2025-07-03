# syntax=docker/dockerfile:1
FROM redis:8.2-m01-bookworm AS redis

RUN apt-get update && apt-get install -y curl netcat

# Add cloudflare gpg key
RUN mkdir -p --mode=0755 /usr/share/keyrings
RUN curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null

# Add this repo to your apt repositories
RUN echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list

RUN apt-get update && apt-get install -y cloudflared

EXPOSE 2000

CMD ["sh", "-c", "while true; do echo -e 'HTTP/1.1 200 OK\n\n$(date)' | nc -l -p 1234; done & cloudflared tunnel --metrics 0.0.0.0:2000 run --token $CLOUDFLARED_TUNNEL_TOKEN"]