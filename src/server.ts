import express = require('express');
import http = require('http');
import socket = require('socket.io');
import cors = require('cors');
import { SignalData } from 'simple-peer';

interface OfferPayload {
  socketID: string;
  signal: SignalData;
}

class Room {
  // Logica onde se duplica a informacao para evitar iterar desnecessariamente sobre os arrays
  private sockets = new Map<string, socket.Socket>();
  private viewers = new Map<string, socket.Socket>();
  private streamer: socket.Socket = null;
  private maxSocketsAtRoom = 3;

  addSocket(socket: socket.Socket) {
    this.sockets.set(socket.id, socket);
    this.viewers.set(socket.id, socket);
  }

  removeSocket(socket: socket.Socket) {
    this.sockets.delete(socket.id);
    this.viewers.delete(socket.id);
  }

  setStreamer(socket: socket.Socket) {
    this.streamer = socket;
    this.viewers.delete(this.streamer.id);
  }

  resetStreamer() {
    if (this.hasStreamer()) {
      this.viewers.set(this.streamer.id, this.streamer);
      this.streamer = null;
    }
  }

  isStreamer(socket: socket.Socket) {
    if (this.hasStreamer()) return socket.id === this.streamer.id;
    return false;
  }

  hasStreamer() {
    return this.streamer !== null && this.streamer !== undefined;
  }

  getStreamerID() {
    if (this.hasStreamer()) return this.streamer.id;
    return '';
  }

  emitTo(socket: socket.Socket | string, topic: string, value?: any) {
    if (typeof socket === 'string') {
      if (this.sockets.get(socket)) this.sockets.get(socket).emit(topic, value);
    } else {
      socket.emit(topic, value);
    }
  }

  emitToStreamer(topic: string, value?: any) {
    if (this.streamer) {
      this.streamer.emit(topic, value);
    }
  }

  emitToAll(topic: string, value?: any) {
    this.sockets.forEach((socket) => socket.emit(topic, value));
  }

  emitToAllViewers(topic: string, value?: any) {
    this.viewers.forEach((viewer) => viewer.emit(topic, value));
  }

  emitToAllExcept(socketToFilter: socket.Socket, topic: string, value?: any) {
    this.sockets.forEach((socket) => {
      if (socketToFilter.id !== socket.id) socket.emit(topic, value);
    });
  }

  getSocketIDsExcept(socketToFilter: socket.Socket) {
    var filteredSockets = new Map(this.sockets);
    filteredSockets.delete(socketToFilter.id);
    return Array.from(filteredSockets.keys());
  }

  getViewersIDs() {
    return Array.from(this.viewers.keys());
  }

  canAddSocket() {
    return this.sockets.size <= this.maxSocketsAtRoom;
  }
}

const app = express();
const server = http.createServer(app);
const io = socket(server);
const room = new Room();
app.use(cors());

io.on('connection', (socket) => {
  socket.on('join_room', () => {
    // Se a sala estiver cheia, informa que nao eh possivel adicionar um novo integrante
    if (!room.canAddSocket()) {
      room.emitTo(socket, 'full_room');
      return;
    }

    // Salva o novo socket
    room.addSocket(socket);

    // Solicita que o streamer crie um peer
    room.emitToStreamer('add_new_peer', socket.id);

    // Informa quem acabou de entrar quem eh o streamer
    room.emitTo(socket, 'streamer_joined', room.getStreamerID());

    // Informa para quem acabou de entrar sobre os integrantes da sala
    room.emitTo(
      socket,
      'send_viewers_of_room',
      room.getSocketIDsExcept(socket)
    );

    // Notifica os integrantes da sala sobre quem acabou de entrar
    room.emitToAllExcept(socket, 'viewer_joined', socket.id);
  });

  // Quando algum integrante decide compartilhar a tela
  socket.on('start_stream', () => {
    // Salva esse integrante como streamer
    room.setStreamer(socket);

    // Devolve os viewers para o streamer
    room.emitToStreamer('create_viewers_peers', room.getViewersIDs());

    // Informa os integrantes quem eh o novo streamer
    room.emitToAll('streamer_joined', socket.id);
  });

  // Quando o streamer parar de compartilhar a tela;
  socket.on('stop_stream', () => {
    // Para indicar que novas streams sao possiveis
    room.resetStreamer();

    // Informa os viewers que o streamer parou a stream
    room.emitToAllViewers('streamer_joined', '');
  });

  // Quando o streamer vai iniciar a transmissao
  socket.on('send_offer', (payload: OfferPayload) => {
    room.emitTo(payload.socketID, 'create_answer', payload.signal);
  });

  // Quando response o streamer com a conexao WebRTC
  socket.on('send_answer', (signal: SignalData) => {
    room.emitToStreamer('accept_answer', {
      signal: signal,
      socketID: socket.id,
    });
  });

  // Quando algum integrante sai da sala
  socket.on('disconnect', () => {
    // Informa o streamer para deletar o viewer que saiu da sala
    room.emitToStreamer('delete_peer', socket.id);

    // Se o streamer sair, novas streams estao disponiveis
    if (room.isStreamer(socket)) room.resetStreamer();

    // Informa todos que o usuário saiu
    room.emitToAll('viewer_quit', socket.id);

    // Remove o socket do viewer que saiu da sala
    room.removeSocket(socket);
  });
});

server.listen(process.env.PORT || 8080, () =>
  console.log('Rodando servidor na porta 8080')
);
