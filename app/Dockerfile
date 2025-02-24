FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install
RUN npm install -g typescript

COPY . .

# Build TypeScript
RUN npm run build

EXPOSE 3000
CMD [ "npm", "start" ]