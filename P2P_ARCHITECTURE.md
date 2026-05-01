# P2P Messenger Architecture

## Overview
Преобразование традиционного клиент-серверного мессенджера в P2P архитектуру с WebRTC.

## Компоненты

### 1. **Signaling Server** (Lightweight)
- **Функции:**
  - Регистрация и регистрация пользователей
  - Хранение адреса и статуса пользователей
  - Обмен WebRTC SDP offer/answer
  - Обмен ICE candidates
  - Обнаружение пользователей (discovery)

- **Технология:** FastAPI + Socket.IO
- **Данные:** Только текущее состояние (memory + Redis optional)
- **Масштабируемость:** Stateless, можно запустить несколько инстансов

### 2. **Frontend (Client)**
- **Хранение:**
  - IndexedDB / LocalStorage для сообщений
  - WebRTC DataChannels для передачи сообщений
  - Service Worker для синхронизации офлайн

- **WebRTC Компоненты:**
  - PeerJS для простого управления WebRTC
  - DataChannels для текстовых сообщений
  - MediaStream для голоса/видео

- **Функционал:**
  - Прямое P2P общение
  - Местная история сообщений
  - Файлопередача через DataChannels
  - Голосовые/видео звонки P2P

### 3. **IPFS Integration** (Optional)
- Распределенное хранилище файлов
- Не требует центрального сервера
- Подходит для архивирования сообщений

## Поток данных

### Регистрация
```
User -> Auth API -> Database -> User Profile Created
```

### Обнаружение пользователя
```
Client A -> Query API -> Signaling Server -> Returns User List -> Client A
```

### Установка P2P соединения
```
Client A -> WebRTC Offer -> Signaling Server -> Client B
Client B -> WebRTC Answer -> Signaling Server -> Client A
ICE Candidates Exchange -> Signaling Server
-> P2P Connection Established
```

### Обмен сообщениями
```
Client A -> Message -> WebRTC DataChannel -> Client B
         -> IndexedDB (Local Storage)
```

## Преимущества

1. **Бесплатное масштабирование** - No bandwidth costs after P2P established
2. **Приватность** - Сообщения не проходят через сервер
3. **Низкие затраты** - Сервер только для discovery
4. **Оффлайн поддержка** - Синхронизация при возвращении онлайн
5. **Отказоустойчивость** - Работает без центрального сервера

## Недостатки и решения

| Проблема | Решение |
|----------|---------|
| Оба пользователя должны быть онлайн | Relay server для offline delivery |
| Сложность NAT traversal | STUN/TURN servers |
| История на разных устройствах | IPFS / Sync layer |
| Групповые чаты | Mesh network или dedicated relay |

## Миграция

### Фаза 1: Минимальный P2P
- WebRTC для 1-1 сообщений
- Оставить REST API для auth
- Локальное хранилище

### Фаза 2: Оптимизация
- Relay server для офлайн
- IPFS для файлов
- Шифрование E2E

### Фаза 3: Масштабирование
- Избатизация от центрального сервера
- Полностью децентрализованная архитектура
