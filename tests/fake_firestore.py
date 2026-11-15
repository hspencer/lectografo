"""Firestore en memoria: filtros y lotes, transacciones serializadas para pruebas."""
import copy
import threading
import uuid


class Snapshot:
    def __init__(self, ref):
        self.reference, self.id = ref, ref.id
        self.valor = copy.deepcopy(ref.coleccion.datos.get(ref.id))
        self.exists = self.valor is not None

    def to_dict(self):
        return copy.deepcopy(self.valor)


class Documento:
    def __init__(self, coleccion, clave):
        self.coleccion, self.id = coleccion, clave

    def get(self, transaction=None):
        return Snapshot(self)

    def set(self, datos):
        self.coleccion.datos[self.id] = copy.deepcopy(datos)

    def update(self, datos):
        self.coleccion.datos[self.id].update(copy.deepcopy(datos))

    def delete(self):
        self.coleccion.datos.pop(self.id, None)


class Coleccion:
    def __init__(self, datos, filtros=(), limite=None):
        self.datos, self.filtros, self.limite = datos, filtros, limite

    def document(self, clave=None):
        return Documento(self, clave or uuid.uuid4().hex)

    def add(self, datos):
        ref = self.document()
        ref.set(datos)
        return None, ref

    def where(self, campo, operador, valor):
        assert operador == "=="
        return Coleccion(self.datos, self.filtros + ((campo, valor),), self.limite)

    def limit(self, cantidad):
        return Coleccion(self.datos, self.filtros, cantidad)

    def get(self):
        docs = [self.document(k).get() for k, d in self.datos.items()
                if all(d.get(c) == v for c, v in self.filtros)]
        return docs[:self.limite]


class Lote:
    def __init__(self):
        self.acciones = []

    def set(self, ref, datos):
        self.acciones.append(lambda: ref.set(datos))

    def update(self, ref, datos):
        self.acciones.append(lambda: ref.update(datos))

    def delete(self, ref):
        self.acciones.append(ref.delete)

    def commit(self):
        for accion in self.acciones:
            accion()


class FirestoreFalso:
    def __init__(self, datos):
        self.datos = datos
        self.lock = threading.RLock()

    def collection(self, nombre):
        return Coleccion(self.datos.setdefault(nombre, {}))

    def transaction(self):
        return Lote()

    batch = transaction

    def transactional(self, fn):
        def ejecutar(tx):
            with self.lock:
                resultado = fn(tx)
                tx.commit()
                return resultado
        return ejecutar
