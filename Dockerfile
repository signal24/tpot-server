FROM node:12-stretch-slim

WORKDIR /usr/src/app

COPY . .

RUN npm install

CMD [ "node", "index.js" ]

EXPOSE 3000