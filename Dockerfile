# syntax=docker/dockerfile:1
FROM redis:8.2-m01-bookworm AS redis
EXPOSE 6379

# Bind Redis to a specific IP address for inter-container communication.
CMD ["redis-server", "--bind", "0.0.0.0"]