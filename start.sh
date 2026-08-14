docker stop vela
docker rm vela
docker build -t vela .
docker run -d --name vela -p 32060:32060 --env-file .env -v vela-data:/app/data vela
