#!/usr/bin/env python

import asyncio
import websockets
import json
import sys
import importlib.util
from datetime import datetime

local = None
remote = None
compTime = 0

def importFile(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

async def _run(websocket, path):
    global local
    global remote
    global compTime
    message = await websocket.recv()
    parsed = None
    try:
      if message is not None:
        parsed = json.loads(message)
    except Exception as e:
        await websocket.close(1011, 'JSON data parse failed')
    if parsed['mode'] == 'remote':
        try:
          start = datetime.now()
          output = await asyncio.get_event_loop().run_in_executor(None, remote, parsed['data'])
          time = (datetime.now() - start).total_seconds()
          compTime += time
          print('remote exec time:', time)
          print('Total time so far:', compTime)
          await websocket.send(json.dumps({ 'type': 'stdout', 'data': output, 'end': True }))
        except Exception as e:
          print(e)
          print('remote data:')
          print(parsed['data'])
          await websocket.send(json.dumps({ 'type': 'stderr', 'data': str(e), 'end': True }))
    elif parsed['mode'] == 'local':
        try:
          start = datetime.now()
          output = await asyncio.get_event_loop().run_in_executor(None, local, parsed['data'])
          time = (datetime.now() - start).total_seconds()
          compTime += time
          print('local exec time:', time)
          print('Total time so far:', compTime)
          await websocket.send(json.dumps({ 'type': 'stdout', 'data': output, 'end': True }))
        except Exception as e:
          print(e)
          print('local data:')
          print(parsed['data'])
          await websocket.send(json.dumps({ 'type': 'stderr', 'data': str(e), 'end': True }))
    else:
      await websocket.close()

def start(localFunction, remoteFunction):
    global local
    global remote
    local = localFunction
    remote = remoteFunction
    start_server = websockets.serve(_run, '0.0.0.0', 8881)
    print("Python microservice started on 8881")

    asyncio.get_event_loop().run_until_complete(start_server)
    asyncio.get_event_loop().run_forever()
