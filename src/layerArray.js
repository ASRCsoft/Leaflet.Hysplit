// a leaflet layer that conveniently organizes multidimensional arrays
// of layers

// also a timedimension layer that works with the layerArray

L.LayerArray = L.LayerGroup.extend({
    cache: [],
    values: [],
    initialize: function(options) {
	L.LayerGroup.prototype.initialize.call(this, []);
	this.options = options;
	this.values = options['values'];
	this.lazy = options['lazy'] || true;
	this.dims = this.values.map(function(x) {return x.length});
	this.ndim = this.dims.length;
	this.ind;
	// and array of boolean values to keep from loading previously
	// loaded data
	this.isLoaded;
	this.setupCache();
	// this should be a function that takes an index array and
	// returns a promise that resolves to the corresponding layer
	if (options['makeLayer']) {
	    this.makeLayer = options['makeLayer'];
	}
    },
    // create the cache where layers are stored
    setupCache: function() {
	var arr_len = 1;
	for (i = 0; i < this.ndim; i++) {
	    arr_len *= this.dims[i];
	}
	this.cache = new Array(arr_len);
	this.isLoaded = new Array(arr_len);
	// this list holds the promises from layers to be added -- the
	// idea is that I can check and make sure all previous layers
	// have finished loading before switching to a new layer
	this.promiseCache = [];
	// this list holds the (long array) indices of the currently
	// loading layers. To make sure I don't load the same layer
	// twice I can check this to see if it's already loading
	this.loadingList = [];
    },
    // get the low-level array index of a set of indices
    indToArrayInd: function(ind) {
	// get the 1D array index
	var arr_ind = 0;
	var dim_n = 1;
	for (i = this.ndim - 2; i >= 0; i--) {
	    // gotta jump this.dims[i + 1] times farther for every
	    // index for this dimension
	    dim_n *= this.dims[i + 1];
	    arr_ind += dim_n * ind[i];
	}
	// add back that last dimension
	arr_ind += ind[this.ndim - 1];
	return arr_ind;
    },
    array: function(ind) {
	return this.cache[this.indToArrayInd(ind)];
    },
    // get the low-level array index of a set of values
    valToArrayInd: function(val) {
	return this.indToArrayInd(this.getValueIndex(val));
    },
    // add a layer to the stored cache of layers
    addToCache: function(ind) {
	// only supports promises for now-- add support for layers
	// later
	var arr_ind = this.indToArrayInd(ind);
	var vals = this.getIndexValue(ind);
	var promiseInd = this.loadingList.indexOf(arr_ind);
	var layer_loading = promiseInd != -1;
	if (layer_loading) {
	    var layerPromise = this.loadingList[promiseInd];
	    return $.when(layerPromise);
	}
	var layerPromise = this.makeLayer(ind, vals);
	if (typeof layerPromise.then !== 'function') {
	    throw 'makeLayer did not return a promise';
	};
	this.promiseCache.push(layerPromise);
	this.loadingList.push(arr_ind);
	var f = function(layer) {
	    // add the layer to the cache
	    this.cache[arr_ind] = layer;
	    // remove layer from the promiseCache
	    var promiseInd = this.loadingList.indexOf(arr_ind);
	    this.loadingList.splice(promiseInd, 1);
	    this.promiseCache.splice(promiseInd, 1);
	    this.isLoaded[arr_ind] = true;
	}.bind(this);
	return layerPromise.then(f);
    },
    // load a layer corresponding to the given indices (without
    // displaying it)
    loadLayer: function(ind) {
	var arr_ind = this.indToArrayInd(ind);
	if (!this.isLoaded[arr_ind]) {
	    return this.addToCache(ind);
	} else {
	    return $.when();
	};
    },
    setIndex: function(ind) {
	this.ind = ind;
    },
    // get the indices of a set of values
    getValueIndex: function(val) {
	var ind = [];
	var is_date;
	for (i = 0; i < this.ndim; i++) {
	    // check if the dimension is a date dimension
	    is_date = this.values[i][0] instanceof Date;
	    if (is_date) {
		ind[i] = this.values[i].map(Number).indexOf(+val[i]);
	    } else if (this.values[i][0] instanceof Object) {
		throw "LayerArray can't get index of object values (except dates)";
	    } else {
		ind[i] = this.values[i].indexOf(val[i]);	
	    }
	    if (ind[i] == -1) {
		throw 'Value ' + val[i] + ' not found in array dimension ' + i;
	    }
	}
	return ind;
    },
    // get the values at an index
    getIndexValue: function(ind) {
	var vals = [];
	for (i = 0; i < this.ndim; i++) {
	    vals.push(this.values[i][ind[i]]);
	};
	return vals;
    },
    // add the layer corresponding to an index
    addIndex: function(ind) {
	return this.loadLayer(ind).then(function() {
	    var arr_ind = this.indToArrayInd(ind);
	    this.addLayer(this.cache[arr_ind]);
	}.bind(this));
    },
    pending: function() {
	return $.when.apply($, this.promiseCache);
    },
    // add the layer corresponding to a value
    addValue: function(val) {
	var ind = this.getValueIndex(val);
	this.addIndex(ind);
    },
    // remove the layer corresponding to an index
    removeIndex: function(ind) {
	this.removeLayer(this.cache[this.indToArrayInd(ind)]);
    },
    // remove the layer corresponding to a value
    removeValue: function(val) {
	this.removeLayer(this.cache[this.valToArrayInd(val)]);
    },
    // remove other layers and add the layer corresponding to the given index
    switchToIndex: function(ind) {
	this.loadLayer(ind);
	return this.pending().done(function() {
	    this.clearLayers();
	    this.addIndex(ind);
	    this.setIndex(ind);
	}.bind(this));
    },
    // remove other layers and add the layer corresponding to the given value
    switchToValue: function(val) {
	var ind = this.getValueIndex(val);
	return this.switchToIndex(ind);
    },
    // change the value of only one dimension
    switchDim: function(dim, ind) {
	// make a copy of the current index
	var new_ind = [];
	// if there is no index just set it to zero
	if (!this.ind) {
	    this.ind = new Array(this.ndim);
	    for (i=0; i<this.ind.length; i++) {
		this.ind[i] = 0;
	    };
	};
	for (i=0; i<this.values.length; i++) {
	    new_ind[i] = this.ind[i];
	}
	// update it
	new_ind[dim] = ind;
	// switch to it
	this.switchToIndex(new_ind);
    },
    makeSlider: function(dim, orientation) {
	var slider_options = {layerArray: this, dim: dim,
			      orientation: orientation ? orientation : 'vertical'};
	return L.control.arraySlider(slider_options);
    }
});

L.layerArray = function(options) {
    return new L.LayerArray(options);
};



L.Control.ArraySlider = L.Control.extend({
    // this is going to have the dimension number and layerarray object
    onAdd: function() {
	var layerArray = this.options.layerArray;
	var dim = this.options.dim || 0;
	var labels = this.options.labels || layerArray.values[dim];
	var dim_length = labels.length;
	var orientation = this.options.orientation || 'horizontal';
	var is_vertical = orientation == 'vertical';
	var title = this.options.title || '';
	var slider_length = this.options.length || (25 * (dim_length - 1)) + 'px';
	// set up the div if it isn't there already
	if (is_vertical) {
	    this._div = L.DomUtil.create('div', 'info slider-axis vertical-axis');
	} else {
	    this._div = L.DomUtil.create('div', 'info slider-axis');
	}
	// var grades = levels,
	//     labels = [];
	var range_title = '<h4>' + title + '</h4>'
	var range = '<div id="height_slider2"></div>'
	this._div.innerHTML = range_title + range;
	var slider = $(this._div).find('div')[0];
	var switch_fn = function(e, ui) {
	    this.switchDim(dim, ui.value);
	}.bind(layerArray);

	// set up the jquery slider
	var slider_options = {max: dim_length - 1, orientation: orientation,
			      slide: switch_fn, change: switch_fn};

	// get the slider labels
	var pip_options = {rest: 'label', labels: labels};
	$(slider).slider(slider_options).slider("pips", pip_options);
	if (is_vertical) {
	    // set the slider height
	    $(slider)[0].style.height = slider_length;
	} else {
	    // set the slider width
	    $(slider)[0].style.width = slider_length;
	}

	// Disable dragging when user's cursor enters the element
	// courtesy of https://gis.stackexchange.com/a/104609
	this._div.addEventListener('mouseover', function (e) {
            this._map.dragging.disable();
	}.bind(this));
	// Re-enable dragging when user's cursor leaves the element
	this._div.addEventListener('mouseout', function (e) {
            this._map.dragging.enable();
	}.bind(this));
	
	return this._div;
    }
})

L.control.arraySlider = function(options) {
    return new L.Control.ArraySlider(options);
};


// A layerArray-compatible timedimension layer (from
// leaflet.timedimension). Based on advice here:
// https://github.com/socib/Leaflet.TimeDimension/issues/19
L.TimeDimension.Layer.LayerArray = L.TimeDimension.Layer.extend({

    initialize: function(layer, options) {
        L.TimeDimension.Layer.prototype.initialize.call(this, layer, options);
	this.dim = this.options.dim;
	this.times = this._baseLayer.values[this.dim];
	this.n_ahead = this.options.n_ahead || 0;
        this._currentLoadedTime = 0;
        this._currentTimeData = null;
    },

    onAdd: function(map) {
	// I think this should be edited somehow to start with the
	// correct time
        L.TimeDimension.Layer.prototype.onAdd.call(this, map);
        // if (this._timeDimension) {
        //     this._getDataForTime(this._timeDimension.getCurrentTime());
        // }
	this._update();
    },

    _onNewTimeLoading: function(ev) {
	// ok. Instead of getting data directly, we're going to get
	// the appropriate layer from site.contours, then call
	// loadData on it
        if (!this._baseLayer._map) {
            return;
        }
	// should probably be grabbing data here and firing event on
	// completion (but this is good enough for now)
	var time = ev.time;
	this.loadTime(time).done(function() {
	    this.fire('timeload', {
		time: time
            });
	}.bind(this));
        return;
    },

    isReady: function(time) {
	return true;
    },

    loadTime: function(t) {
	// copy the current index
	var new_ind = this._baseLayer.ind.slice();
	var time_index = this.times.indexOf(t);
	if (time_index == -1) {
	    throw 'Time not found in loadTime function.'
	};
	new_ind[this.dim] = time_index;
	return this._baseLayer.loadLayer(new_ind);
    },

    switchTimeVal: function(new_time) {
	var ind = this.times.indexOf(new_time);
	if (ind == -1) {
	    throw "LayerArray doesn't have the requested time";
	};
	this._baseLayer.switchDim(this.dim, ind);
    },

    _update: function() {
	// switch to the appropriate time
        if (!this._baseLayer._map)
            return;
	var current_time = this._timeDimension.getCurrentTime();
	// if the layerArray has the current time
	var current_time_ind = this.times.indexOf(current_time);
	var has_time = current_time_ind != -1;
	if (has_time) {
	    this.switchTimeVal(current_time);
	    this._currentLoadedTime = current_time;
	    // load the next layers, if desired
	    for (i=1; i<=this.n_ahead; i++) {
		this.loadTime(this.times[current_time_ind + i]);
	    }
	}
    }
});

L.timeDimension.layer.layerArray = function(layer, options) {
    return new L.TimeDimension.Layer.LayerArray(layer, options);
};
