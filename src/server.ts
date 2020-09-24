import express = require('express');
import http = require('http');
import socket = require('socket.io');
import cors = require('cors');
import { SignalData } from 'simple-peer';

interface OfferPayload {
  socketId: string;
  signal: SignalData;
}

const app = express();
const server = http.createServer(app);
const io = socket(server);

var viewers = new Map<string, socket.Socket>();
var streamer: socket.Socket;
const maxUsersAtRoom = 3;

app.use(cors());

io.on('connection', (socket) => {
  // Quando alguem entra na sala
  socket.on('join_room', () => {
    // Se a sala estiver cheia, informa o usuario e sai do metodo
    if (getAllSockets().length > maxUsersAtRoom) {
      socket.emit('full_room');
      return;
    }

    // Salva o novo viewer na sala
    viewers.set(socket.id, socket);

    // Se a stream ja estiver acontecendo, informa o streamer
    // para criar um peer para o novo viewer
    if (streamer) {
      streamer.emit('add_new_peer', socket.id);
      // Informa que acabou de entrar no quem eh o streamer para atualizar a UI
      socket.emit('streamer_joined', streamer.id);
    }

    // Informa para quem acabou de entrar sobre os integrantes da sala para mostrar na UI
    socket.emit(
      'send_viewers_of_room',
      getAllIds().filter((id) => id !== socket.id)
    );

    // Informa os integrantes da sala sobre quem acabou de entrar para mostrar na UI
    getAllSockets().forEach((sock) => {
      if (sock.id !== socket.id) {
        sock.emit('viewer_joined', socket.id);
      }
    });

    // Informa para o usuario seu id para mostrar na UI
    socket.emit('join_accept', socket.id);
  });

  // Quando algum viewer decide compartilhar a tela
  socket.on('start_stream', () => {
    // Salva esse viewer como streamer
    streamer = socket;

    // Remove o streamer do Map de viewers
    viewers.delete(socket.id);

    // Devolve os viewers para o streamer
    socket.emit('create_peers_to_start_stream', Array.from(viewers.keys()));
    // Informa os viewers quem comecou a stream
    getAllSockets().forEach(sock => sock.emit('streamer_joined', socket.id));
  });

  // Quando o streamer parar de compartilhar a tela;
  socket.on('stop_stream', () => {
    // Para indicar que novas streams sao possiveis
    streamer = null;

    // Adiciona os streamer que parou a transmissao como viewer
    viewers.set(socket.id, socket);
    // Informa os viewers que o streamer parou a stream
    getAllSockets().forEach(sock => sock.emit('streamer_joined', ''));
  });

  // Quando o streamer notifica os viewers que vai iniciar a transmissao
  // Um peer por vez é enviado para cada viewer
  socket.on('send_offer', (payload: OfferPayload) => {
    viewers.forEach((viewer) => {
      // Garante que o viewer que deve criar uma answer
      // eh o da iteracao atual do streamer
      if (viewer.id === payload.socketId) {
        // solicita que o viewer crie uma resposta para o peer
        viewer.emit('create_answer', payload.signal);
      }
    });
  });

  // Quando um viewer cria um peer e responde o streamer
  socket.on('send_answer', (signal: SignalData) => {
    // Passa a resposta do viewer para o streamer para finalizar o handshake
    streamer.emit('accept_answer', { signal: signal, socketId: socket.id });
  });

  // Quando alguem sai da sala
  socket.on('disconnect', () => {
    // Informa o streamer para deletar o viewer que saiu da sala
    if (streamer) {
      streamer.emit('delete_peer', socket.id);

      // Se o streamer sair, novas streams estao disponiveis
      if (streamer.id === socket.id) streamer = null;
    }

    // Informa todos que o usuário saiu
    emitToAll('viewer_quit', socket.id);

    // Remove o socket do viewer que saiu da sala
    viewers.delete(socket.id);
  });
});

server.listen(process.env.PORT || 8080, () => console.log('Rodando servidor na porta 8080'));

function emitToAll(topic: string, value: any) {
  if (streamer) {
    streamer.emit(topic, value);
  }

  viewers.forEach((viewer) => viewer.emit(topic, value));
}

function getAllIds(): string[] {
  const ret: string[] = [];

  if (streamer) {
    ret.push(streamer.id);
  }

  viewers.forEach((viewer) => ret.push(viewer.id));
  return ret;
}

function getAllSockets(): SocketIO.Socket[] {
  const ret: SocketIO.Socket[] = [];
  
  if (streamer) {
    ret.push(streamer);
  }

  viewers.forEach((viewer) => ret.push(viewer));

  return ret;
}
