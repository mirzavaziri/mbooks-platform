// Runtime adapter: implements the same window.claude surface the studio
// code already calls (see mock.js / mkharness.py in the handoff package),
// backed by this app's REST API + a per-book SSE stream instead of the
// claude.ai artifact runtime. Loaded as a plain <script> before the
// studio's own inline script, so `window.claude` exists by the time it runs.
(function () {
  var bookId = window.__MBOOK_ID__;
  var me = window.__MBOOK_USER__;

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    return fetch(path, opts).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (body) {
        if (!res.ok) {
          var err = new Error(body.error || ('http_' + res.status));
          err.code = body.error || ('http_' + res.status);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  // ---- one shared SSE connection per book, fanned out to subscribers ----
  var listeners = [];
  var es = null;
  function ensureStream() {
    if (es) return;
    es = new EventSource('/api/books/' + bookId + '/events');
    es.onmessage = function (ev) {
      var change;
      try {
        change = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      listeners.forEach(function (fn) {
        fn(change);
      });
    };
    es.onerror = function () {
      // EventSource auto-reconnects; nothing to do.
    };
  }
  function onChange(fn) {
    ensureStream();
    listeners.push(fn);
    return function () {
      listeners.splice(listeners.indexOf(fn), 1);
    };
  }

  // ---- collection() query builder: cache the whole collection locally,
  //      like the claude.ai mock did, and keep it fresh via SSE ----
  function makeCollection(name) {
    var cache = {}; // id -> {data, version}
    var loaded = false;
    var pending = null;

    function load() {
      if (pending) return pending;
      pending = api('/api/books/' + bookId + '/collections/' + name).then(function (res) {
        cache = {};
        res.docs.forEach(function (d) {
          cache[d.id] = { data: d.data, version: d.version };
        });
        loaded = true;
      });
      return pending;
    }

    function applyChange(change) {
      if (change.collection !== name) return;
      if (change.deleted) {
        delete cache[change.id];
      } else if (change.data !== undefined) {
        cache[change.id] = { data: change.data, version: change.version };
      } else {
        // No inline data (e.g. a restore): refetch that one doc.
        api('/api/books/' + bookId + '/docs/' + name + '/' + change.id)
          .then(function (doc) {
            cache[change.id] = doc;
          })
          .catch(function () {
            delete cache[change.id];
          });
      }
    }

    function query(filt, ord) {
      return {
        where: function (field, op, value) {
          return query([field, op, value], ord);
        },
        orderBy: function (field) {
          return query(filt, field);
        },
        onSnapshot: function (onNext, onError) {
          var unsubscribeChange = onChange(function (change) {
            if (change.collection !== name) return;
            applyChange(change);
            emit();
          });

          function emit() {
            var docs = Object.keys(cache).map(function (id) {
              return { id: id, data: function () { return cache[id].data; } };
            });
            if (filt) {
              docs = docs.filter(function (d) {
                return d.data()[filt[0]] === filt[2];
              });
            }
            if (ord) {
              docs.sort(function (a, b) {
                return (a.data()[ord] || 0) - (b.data()[ord] || 0);
              });
            }
            onNext({ docs: docs, size: docs.length, empty: docs.length === 0 });
          }

          load().then(emit).catch(function (err) {
            if (onError) onError({ code: err.code || 'load_failed' });
          });

          return function () {
            unsubscribeChange();
          };
        },
        add: function (data) {
          return api('/api/books/' + bookId + '/collections/' + name, { method: 'POST', body: data }).then(
            function (res) {
              cache[res.id] = { data: data, version: res.version };
              return { id: res.id };
            },
          );
        },
        doc: function (id) {
          return makeDocRef(name, id, cache);
        },
      };
    }

    return query(null, null);
  }

  function makeDocRef(name, id, collectionCache) {
    var lastVersion = collectionCache && collectionCache[id] ? collectionCache[id].version : null;

    function write(method, body) {
      var headers = {};
      if (lastVersion !== null) headers['x-doc-version'] = String(lastVersion);
      return api('/api/books/' + bookId + '/docs/' + name + '/' + id, { method: method, headers: headers, body: body })
        .then(function (res) {
          lastVersion = res.version;
          return res;
        })
        .catch(function (err) {
          if (err.status === 409) {
            var e = new Error('version_conflict');
            e.code = 'version_conflict';
            throw e;
          }
          throw err;
        });
    }

    return {
      set: function (data) {
        return write('PUT', data).then(function () {});
      },
      update: function (patch) {
        return write('PATCH', patch).then(function () {});
      },
      delete: function () {
        return api('/api/books/' + bookId + '/docs/' + name + '/' + id, { method: 'DELETE' }).then(function () {});
      },
      onSnapshot: function (onNext, onError) {
        var current = null;
        var unsubscribeChange = onChange(function (change) {
          if (change.collection !== name || change.id !== id) return;
          if (change.deleted) {
            current = null;
            lastVersion = null;
            onNext({ exists: false, data: function () { return undefined; } });
            return;
          }
          if (change.data !== undefined) {
            current = change.data;
            lastVersion = change.version;
            onNext({ exists: true, data: function () { return current; } });
          }
        });

        api('/api/books/' + bookId + '/docs/' + name + '/' + id)
          .then(function (doc) {
            current = doc.data;
            lastVersion = doc.version;
            onNext({ exists: true, data: function () { return current; } });
          })
          .catch(function (err) {
            if (err.status === 404) {
              onNext({ exists: false, data: function () { return undefined; } });
            } else if (onError) {
              onError({ code: err.code || 'load_failed' });
            }
          });

        return function () {
          unsubscribeChange();
        };
      },
    };
  }

  var db = {
    collection: function (name) {
      return makeCollection(name);
    },
    doc: function (path) {
      var parts = path.split('/');
      return makeDocRef(parts[0], parts[1], null);
    },
  };

  function initials(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  function avatarDataUri(initial, color) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
      '<rect width="40" height="40" rx="20" fill="' + color + '"/>' +
      '<text x="20" y="26" font-size="18" text-anchor="middle" fill="white" font-family="sans-serif">' +
      initial +
      '</text></svg>';
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  var user = {
    me: function () {
      return Promise.resolve({
        id: me.id,
        name: me.name,
        avatarUrl: avatarDataUri(initials(me.name), me.color),
        color: me.color,
      });
    },
    can: function (level) {
      if (level === 'data.write') return Promise.resolve(me.role !== 'reviewer');
      return Promise.resolve(true);
    },
    profiles: function (ids) {
      return api('/api/books/' + bookId + '/members').then(function (res) {
        var byId = {};
        res.members.forEach(function (m) {
          byId[m.id] = { name: m.name };
        });
        var out = {};
        [].concat(ids).forEach(function (id) {
          out[id] = byId[id] || { name: 'Unknown' };
        });
        return out;
      });
    },
  };

  var assets = {
    upload: function (blob, meta) {
      var form = new FormData();
      var filename = (meta && meta.name) || 'upload';
      form.append('file', blob, filename);
      return fetch('/api/books/' + bookId + '/assets', { method: 'POST', credentials: 'same-origin', body: form }).then(
        function (res) {
          return res.json().then(function (body) {
            if (!res.ok) {
              var err = new Error(body.error);
              err.code = body.error;
              throw err;
            }
            return { id: body.id };
          });
        },
      );
    },
    delete: function (id) {
      return api('/api/books/' + bookId + '/assets/' + id, { method: 'DELETE' }).then(function () {});
    },
  };

  var downloads = {
    save: function (opts) {
      try {
        var blob = new Blob([opts.data], { type: 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = opts.filename || 'download.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
        }, 2000);
        return Promise.resolve();
      } catch (e) {
        var err = new Error('declined');
        err.code = 'declined';
        return Promise.reject(err);
      }
    },
  };

  window.claude = {
    use: function (name) {
      return Promise.resolve({ db: db, user: user, assets: assets, downloads: downloads }[name] || null);
    },
  };
})();
