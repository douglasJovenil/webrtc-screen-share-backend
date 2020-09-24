import express = require('express');
import http = require('http');
import socket = require('socket.io');
import cors = require('cors');
import { SignalData } from 'simple-peer';

interface OfferPayload {
  socketID: string;
  signal: SignalData;
}

const app = express();
const server = http.createServer(app);
const io = socket(server);

var sockets = new Map<string, socket.Socket>();
var streamer: socket.Socket;
const maxUsersAtRoom = 3;

app.use(cors());

io.on('connection', (socket) => {
  console.log('connection');
  // Quando alguem entra na sala
  socket.on('join_room', () => {
    console.log('on: join_room');
    // Se a sala estiver cheia, informa o usuario e sai do metodo
    if (sockets.size > maxUsersAtRoom) {
      console.log('emit: full_room');
      socket.emit('full_room');
      return;
    }

    // Salva o novo integrante na sala
    sockets.set(socket.id, socket);

    // Se a stream ja estiver acontecendo, informa o streamer
    // para criar um peer para o novo viewer
    if (streamer) {
      console.log('emit: add_new_peer');
      streamer.emit('add_new_peer', socket.id);
      // Informa quem acabou de entrar quem eh o streamer
      console.log('emit: streamer_joined');
      socket.emit('streamer_joined', streamer.id);
    }

    // Informa para quem acabou de entrar sobre os integrantes da sala
    console.log('emit: send_viewers_of_room');
    console.log(getAllSockets().map((currentSocket) => currentSocket.id));
    socket.emit(
      'send_viewers_of_room',
      // getAllSockets().filter((currentSocket) => currentSocket.id !== socket.id)
      getAllSocketsIDs().filter((id) => id !== socket.id)
    );

    // Informa os integrantes da sala sobre quem acabou de entrar
    sockets.forEach((sock) => {
      if (sock.id !== socket.id) {
        console.log('emit: viewer_joined');
        sock.emit('viewer_joined', socket.id);
      }
    });
  });

  // Quando algum integrante decide compartilhar a tela
  socket.on('start_stream', () => {
    console.log('on: start_stream');
    // Salva esse integrante como streamer
    streamer = socket;

    // Devolve os viewers para o streamer
    console.log('emit: create_viewer_peers');
    socket.emit(
      'create_viewers_peers',
      getAllViewers().map((viewer) => viewer.id)
    );

    console.log('emit: streamer_joined');
    // Informa os integrantes quem eh o novo streamer
    sockets.forEach((currentSocket) =>
      currentSocket.emit('streamer_joined', socket.id)
    );
  });

  // Quando o streamer parar de compartilhar a tela;
  socket.on('stop_stream', () => {
    console.log('on: stop_stream');
    // Para indicar que novas streams sao possiveis
    streamer = null;

    console.log('emit: streamer_joined');
    // Informa os viewers que o streamer parou a stream
    getAllViewers().forEach((sock) => sock.emit('streamer_joined', ''));
  });

  // Quando o streamer notifica os viewers que vai iniciar a transmissao
  // Um peer por vez é enviado para cada viewer
  socket.on('send_offer', (payload: OfferPayload) => {
    sockets.get(payload.socketID).emit('create_answer', payload.signal);
  });

  // Quando um viewer cria um peer e responde o streamer
  socket.on('send_answer', (signal: SignalData) => {
    console.log('on: send_answer');
    // Passa a resposta do viewer para o streamer para finalizar o handshake
    console.log('emit: accept_answer');
    streamer.emit('accept_answer', { signal: signal, socketID: socket.id });
  });

  // Quando alguem sai da sala
  socket.on('disconnect', () => {
    console.log('on: disconnect');

    console.log('emit: delete_peer');
    // Informa o streamer para deletar o viewer que saiu da sala
    if (streamer) streamer.emit('delete_peer', socket.id);

    // Se o streamer sair, novas streams estao disponiveis
    if (streamer && streamer.id === socket.id) streamer = null;

    console.log('emit: viewer_quit');
    // Informa todos que o usuário saiu
    sockets.forEach((currentSocket) =>
      currentSocket.emit('viewer_quit', socket.id)
    );

    // Remove o socket do viewer que saiu da sala
    sockets.delete(socket.id);
  });
});

server.listen(process.env.PORT || 8080, () =>
  console.log('Rodando servidor na porta 8080')
);

function getAllSockets(): SocketIO.Socket[] {
  return Array.from(sockets.values());
}

function getAllViewers(): SocketIO.Socket[] {
  return Array.from(sockets.values()).filter(
    (currentSocket) => currentSocket !== streamer
  );
}

function getAllSocketsIDs(): string[] {
  return Array.from(sockets.keys());
}
