import json,urllib.request,urllib.parse,time
import websocket
base='http://127.0.0.1:8787'
def req(path, data=None):
    raw=None if data is None else urllib.parse.urlencode(data).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(base+path,data=raw),timeout=10))
pair=json.loads(req('/api/pair-code',{})['code'])
def connect():
    return websocket.create_connection(base.replace('http://','ws://')+'/api/device/ws',header=['Authorization: Bearer '+pair['service'],'X-Device-Key: '+pair['key']],timeout=5)
state=dict(device='F1-Lamp',apiVersion=3,power=True,color='#ff0000',brightness=40,speed=100,effect='rev',zones=[True]*3)
ws=connect()
ws.send(json.dumps(dict(type='sync',ack=0,state=state)))
r=req('/api/state',dict(power='0',brightness='41',speed='100',effect='static',zones='111',replay='1'))
message=json.loads(ws.recv())
while message['revision'] != r['revision']:
    message=json.loads(ws.recv())
assert message['type']=='command' and message['state']['power'] is False and message['revision']==r['revision']
assert req('/api/state')['pending'] is True
state={k:v for k,v in message['state'].items() if k!='replay'}
ws.send(json.dumps(dict(type='sync',ack=message['revision'],state=state)))
time.sleep(.1)
confirmed=req('/api/state')
assert confirmed['pending'] is False and confirmed['power'] is False and confirmed['brightness']==41
ws.close()
time.sleep(.1)
r=req('/api/state',dict(power='1',brightness='40',speed='100',effect='rev',zones='111',replay='0'))
assert r['pending'] is True and r['revision']>message['revision']
ws=connect()
ws.send(json.dumps(dict(type='sync',ack=message['revision'],state=state)))
replayed=json.loads(ws.recv())
assert replayed['revision']==r['revision'] and replayed['state']['power'] is True
ws.close()
print('PASS: command delivery, device acknowledgment, offline queuing, reconnect replay, increasing revisions')
