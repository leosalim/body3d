# The body3d demo (index.html) and embed page (embed.html) as a static site behind nginx.
#   docker build -t body3d ./body3d
#   docker run --rm -p 5195:8080 body3d      → http://localhost:5195
# The models (public/models/*.glb) are built by the pipeline beforehand; this only bundles the JS.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/app /usr/share/nginx/html
EXPOSE 8080
