// classes for HYSPLIT interactive viewer app

// extending the geojson time dimension layer to allow backward
// trajectories
L.TimeDimension.Layer.GeoJson2 = L.TimeDimension.Layer.GeoJson.extend({
    initialize: function(layer, options) {
	this.fwd = !!options['fwd'];
        L.TimeDimension.Layer.GeoJson.prototype.initialize.call(this, layer, options);
    },
    _update: function() {
        if (!this._map)
            return;
        if (!this._loaded) {
            return;
        }

        var time = this._timeDimension.getCurrentTime();

	if (this.fwd) {
	    var maxTime = this._timeDimension.getCurrentTime(),
		minTime = 0;
            if (this._duration) {
		var date = new Date(maxTime);
		L.TimeDimension.Util.subtractTimeDuration(date, this._duration, true);
		minTime = date.getTime();
            }
	} else {
	    var minTime = this._timeDimension.getCurrentTime(),
		maxTime = new Date(Math.max.apply(null, this._availableTimes));
	}


        // new coordinates:
        var layer = L.geoJson(null, this._baseLayer.options);
        var layers = this._baseLayer.getLayers();
        for (var i = 0, l = layers.length; i < l; i++) {
            var feature = this._getFeatureBetweenDates(layers[i].feature, minTime, maxTime);
            if (feature) {
                layer.addData(feature);
                if (this._addlastPoint && feature.geometry.type == "LineString") {
                    if (feature.geometry.coordinates.length > 0) {
                        var properties = feature.properties;
                        properties.last = true;
                        layer.addData({
                            type: 'Feature',
                            properties: properties,
                            geometry: {
                                type: 'Point',
                                coordinates: feature.geometry.coordinates[feature.geometry.coordinates.length - 1]
                            }
                        });
                    }
                }
            }
        }

        if (this._currentLayer) {
            this._map.removeLayer(this._currentLayer);
        }
        if (layer.getLayers().length) {
            layer.addTo(this._map);
            this._currentLayer = layer;
        }
    },
    _getFeatureBetweenDates: function(feature, minTime, maxTime) {
        var featureStringTimes = this._getFeatureTimes(feature);
        if (featureStringTimes.length == 0) {
            return feature;
        }
        var featureTimes = [];
        for (var i = 0, l = featureStringTimes.length; i < l; i++) {
            var time = featureStringTimes[i]
            if (typeof time == 'string' || time instanceof String) {
                time = Date.parse(time.trim());
            }
            featureTimes.push(time);
        }
	var index_min = null,
            index_max = null,
            l = featureTimes.length;
	if (this.fwd) {
	    if (featureTimes[0] > maxTime || featureTimes[l - 1] < minTime) {
		return null;
            }
            if (featureTimes[l - 1] > minTime) {
		for (var i = 0; i < l; i++) {
                    if (index_min === null && featureTimes[i] > minTime) {
			// set index_min the first time that current time is greater the minTime
			index_min = i;
                    }
                    if (featureTimes[i] > maxTime) {
			index_max = i;
			break;
                    }
		}
            }
	} else {
	    // the times are backward
	    if (featureTimes[l - 1] > maxTime || featureTimes[0] < minTime) {
		return null;
            }
            if (featureTimes[l - 1] < maxTime) {
		for (var i = 0; i < l; i++) {
                    if (index_min === null && featureTimes[i] <= maxTime) {
			// set index_min the first time that current time is less than the maxTime
			index_min = i;
                    }
                    if (featureTimes[i] < minTime) {
			index_max = i;
			break;
                    }
		}
            }
	}

        if (index_min === null) {
            index_min = 0;
        }
        if (index_max === null) {
            index_max = l;
        }
        var new_coordinates = [];
        if (feature.geometry.coordinates[0].length) {
            new_coordinates = feature.geometry.coordinates.slice(index_min, index_max);
        } else {
            new_coordinates = feature.geometry.coordinates;
        }
        return {
            type: 'Feature',
            properties: feature.properties,
            geometry: {
                type: feature.geometry.type,
                coordinates: new_coordinates
            }
        };
    }
});

L.timeDimension.layer.geoJson2 = function(layer, options) {
    return new L.TimeDimension.Layer.GeoJson2(layer, options);
};

// fixing a minor bug which occurs when changing transition
// times. See: https://github.com/socib/Leaflet.TimeDimension/pull/110
L.TimeDimension.Player = L.TimeDimension.Player.extend({
    setTransitionTime: function(transitionTime) {
        this._transitionTime = transitionTime;
        if (typeof this._buffer === 'function') {
            this._bufferSize = this._buffer.call(this, this._transitionTime, this._minBufferReady, this._loop);
            console.log('Buffer size changed to ' + this._bufferSize);
        } else {
            this._bufferSize = this._buffer;
        }
        if (this._intervalID) {
            this.stop();
            this.start(this._steps);
        }
        this.fire('speedchange', {
            transitionTime: transitionTime,
            buffer: this._bufferSize
        });
    }
});


L.LayerArray.Contours = L.LayerArray.extend({
    // some special layerArray functions just for us
    initialize: function(options) {
	L.LayerArray.prototype.initialize.call(this, options);
	this.time = 0;
	this.height = 0;
    },
    setIndex: function(ind) {
	this.ind = ind;
	this.time = ind[0];
	this.height = ind[1];
    },
    switchTimeVal: function(t) {
	var time_index = this.values[0].indexOf(t);
	if (this.time == time_index) {
	    // don't do anything
	    return false;
	}
	if (time_index == -1) {
	    throw 'Time not found in switchTimeVal function.'
	}
	this.switchToIndex([time_index, this.height]);
    },
    switchHeight: function(h) {
	this.switchToIndex([this.time, h]);
    },
    loadTime: function(t) {
	var time_index = this.values[0].indexOf(t);
	if (time_index == -1) {
	    throw 'Time not found in loadTime function.'
	}
	return this.loadLayer([time_index, this.height]);
    },
});

L.layerArray.contours = function(options) {
    return new L.LayerArray.Contours(options);
};


// A layer containing the contours and trajectories for HYSPLIT and
// coordinating them with the contour_layer and trajectory layers
L.LayerGroup.Hysplit = L.LayerGroup.extend({
    // this object holds all of the site-specific objects
    initialize: function(options) {
	// will need to have: site name, fwd, date, hysplit
	L.LayerGroup.prototype.initialize.call(this, []);
	this.options = options;
	// this.name = this.options.name;
	if (this.options.fwd === undefined) {
	    this.fwd = true;
	} else if (this.options.fwd === false) {
	    this.fwd = false;
	} else {
	    this.fwd = true;
	};
	this.date = this.options.date;
	this._hysplit = this.options.hysplit; // ?? that's not what I want
	// set these options directly!
	this.contour_layer = this.options.contour_layer;
	this.ens_trajectory_layer = this.options.ens_trajectory_layer;
	this.single_trajectory_layer = this.options.single_trajectory_layer;
	// start at time and height = 0
	this.time = 0;
	this.height = 0;
	this.data = this.options.metadata;
	if (this.fwd) {
	    this.times = this.data['times'].map(function(text) {return new Date(text)});
	} else {
	    this.times = this.data['times'].map(function(text) {return new Date(text)}).reverse();
	};
	this.heights = this.data['heights'];
	// a layerArray layer with contour topojson layers
	this.contours;
	// ensemble trajectories
  	this.trajectories;
	// single trajectory
	this.trajectory;
	// this.getColor = this._hysplit.getColor;
	// this.getColor = this.options.getColor;
	this.time_slider;
	this.height_slider;
	this.timedim = this.options.timedim;
	this.td_layer;
    },
    getColor: function(d) {
	return d >= -10 ? '#800000' :
	    d >= -11 ? '#ff3200' :
	    d >= -12 ? '#ffb900' :
	    d >= -13 ? '#b6ff41' :
	    d >= -14 ? '#41ffb6' :
	    d >= -15 ? '#00a4ff' :
	    d >= -16 ? '#0012ff' :
	    '#000080';
    },
    contourStyle: function(feature) {
	return {
	    weight: 0,
	    opacity: 1,
	    color: 'white',
	    fillOpacity: 0.5,
	    fillColor: this.getColor(feature.properties.level)
	};
    },
    highlightFeature: function(e) {
	var contour = e.target;
	var tooltip_options = {sticky: true};
	var tooltip = L.tooltip(tooltip_options);
	contour.bindTooltip(tooltip).openTooltip();
	contour.setTooltipContent(contour.feature.properties.level_name);
    },
    resetHighlight: function(e) {
	// pm_layer.resetStyle(e.target);
	// info.update();
    },
    zoomToFeature: function(e) {
	map.fitBounds(e.target.getBounds());
    },
    onEachFeature: function(feature, layer) {
	var this2 = this;
	layer.on({
	    mouseover: this2.highlightFeature,
	    mouseout: this2.resetHighlight,
	    click: this2.zoomToFeature
	});
    },
    ensTrajStyle: function(feature) {
  	return {
  	    weight: 3,
  	    opacity: .6,
  	    color: '#5075DB'
  	};
    },
    singleTrajStyle: function(feature) {
	return {
	    weight: 3,
	    opacity: .6,
	    color: '#FF0033'
	};
    },
    displayData: function(time, height) {
	this.contours.switchToIndex([time, parseInt(height)]);
	this.time = time;
	this.height = parseInt(height);
	
    },
    changeTime: function(time) {
	this.displayData(time, this.height);
    },
    changeHeight: function(e, ui) {
	var units;
	var time = this.times.indexOf(this.timedim.getCurrentTime());
	if (time == -1) {
	    throw 'Time not found in changeHeight function.'
	}
	var height_index = ui.value;
	this.displayData(time, height_index);
	var height = this.heights[height_index]; // the actual height value, in meters
	if (height > 0) {
	    units = 'm<sup>-3</sup>';
	} else {
	    units = 'm<sup>-2</sup>';
	}
	$.each($('._units_here'), function(i, x) {x.innerHTML = units});
    },
    makeHeightLabel: function(h) {
	var heights = this.heights;
    	if (heights[h] == 0) {
    	    return 'Deposition';
	} else if (h == 0) {
	    return '0-' + heights[h] + 'm';
    	} else {
    	    return heights[h - 1] + '-' + heights[h] + 'm';
    	}
    },
    createHeightSlider: function(map) {
	// make a height slider using the contour layerArray

	// put together some fancy labels first
	var nheights = this.heights.length;
	var labels = [];
	for (i = 0; i < nheights; i++) {
	    labels.push(this.makeHeightLabel(i));
	}
	// make sure this.contours has the current index so that the
	// height slider knows what to switch to
	// this.time = this.times.indexOf(this.timedim.getCurrentTime());
	// this.contours.ind = [this.time, 0];
	var slider_options = {
	    layerArray: this.contours,
	    position: 'bottomleft',
	    orientation: 'vertical',
	    // orientation: 'horizontal',
	    dim: 1, // the height dimension in the layerArray
	    labels: labels,
	    title: 'Dispersion Height<br>(AGL)',
	    // length: '50px'
	};
	this.height_slider = L.control.arraySlider(slider_options);
	this.height_slider.addTo(map);
    },
    setup_sliders: function(map) {
	if (!this.height_slider) {
	    this.createHeightSlider(map);
	} else {
	    this.height_slider.addTo(map);   
	}
    },
    addContour: function() {
	this.displayData(this.time, this.height);
    },
    remove_sliders: function() {
	try {
	    this.height_slider.remove();	    
	} catch(err) {}
    },
    clearLayers: function() {
	this.contour_layer.removeLayer(this.contours);
	this.ens_trajectory_layer.removeLayer(this.trajectories);
	this.single_trajectory_layer.removeLayer(this.trajectory);
	this.td_layer.remove();
    },
    onAdd: function(map) {
	this.setup_sliders(map);
	this.contour_layer.addLayer(this.contours);
	this.ens_trajectory_layer.addLayer(this.trajectories);
	this.single_trajectory_layer.addLayer(this.trajectory);
	this.td_layer.addTo(map);
	// check to see if a contour has already been added
	// no don't dummy
	// if (!this.contours.ind) {
	//     // this.contours.setIndex([0,0]);
	//     this.contours.switchToIndex([0,0]);
	// };
    },
    onRemove: function() {
	this.remove_sliders();
	this.clearLayers();
    }
});

L.layerGroup.hysplit = function(options) {
    return new L.LayerGroup.Hysplit(options);
};


// a layerArray designed specifically for switching between simulation
// results -- should control timeslider, height slider, and
// layergroups for contours, trajectories, etc.
L.LayerArray.Simulations = L.LayerArray.extend({
    // some special SimulationArray functions just for us
    initialize: function(options) {
	L.LayerArray.prototype.initialize.call(this, options);
	// set these options directly!
	this.contour_layer = this.options.contour_layer;
	this.ens_trajectory_layer = this.options.ens_trajectory_layer;
	this.single_trajectory_layer = this.options.single_trajectory_layer;
	// this.getColor = this.options.getColor;

	// useful for organizing the controls
	// this.time_slider;
	// this.height_slider;
	this.timedim = this.options.timedim;
    },
    resetTimedim: function(changeFwd) {
	var cur_hysplit = this.array(this.ind);
	var fwd = cur_hysplit.fwd;
	var times = cur_hysplit.times;
	if (!this.timedim) {
	    if (fwd) {
		var start_time = Math.min.apply(null, this.times);
	    } else {
		var start_time = Math.max.apply(null, this.times);
	    }
	    var timedim_options = {times: times,
				   currentTime: start_time};
	    this.timedim = L.timeDimension(timedim_options);
	} else {
	    // this is a bit weird-- when changing the date, also want
	    // to change the time to match the current hours from
	    // release/reception
	    var has_times = this.timedim._availableTimes.length > 0
	    // var hysplit = this._hysplit;
	    if (has_times) {
		// do different things depending on if we're switching
		// directions
		var cur_hours = this.timedim._currentTimeIndex;
		if (changeFwd) {
		    if (fwd) {
			// start at the first hour after release
			var new_time = times[0];
		    } else {
			// start at the last hour before reception
			var new_time = times[times.length - 1];
		    };
		} else {
		    // keep the current hour index
		    var new_time = times[cur_hours];
		};

		// temporarily disconnect the hysplit contour layer
		// from the time dimension while we switch times
		var contour_layer = cur_hysplit.td_layer;

		// unregister the contour layer
		this.timedim.unregisterSyncedLayer(contour_layer);
		this.timedim.off("timeloading", contour_layer._onNewTimeLoading, contour_layer);
		this.timedim.off("timeload", contour_layer._update, contour_layer);

		this.timedim.setAvailableTimes(times, 'replace');

		// reregister the contour layer
		this.timedim.on("timeloading", contour_layer._onNewTimeLoading, contour_layer);
		this.timedim.on("timeload", contour_layer._update, contour_layer);
		this.timedim.registerSyncedLayer(cur_hysplit.td_layer);

		this.timedim.setCurrentTime(new_time);
	    } else {
		this.timedim.setAvailableTimes(times, 'replace');
	    };
	};
    },
    // remove other layers and add the layer corresponding to the
    // given index, fix the sliders too
    switchToIndex: function(ind) {
	var has_old = !!this.ind;
	if (has_old) {
	    // do a little more checking to see if it actually has a
	    // layer already
	    has_old = !!this.array(this.ind)
    	};
    	if (has_old) {
	    var oldFwd = this.array(this.ind).fwd;
    	};
    	this.clearLayers();
    	this.setIndex(ind);
    	return this.addIndex(ind).done(function() {
	    var newFwd = this.array(ind).fwd;
	    if (has_old) {
		var changeFwd = oldFwd != newFwd;
    	    } else {
    		var changeFwd = false;
    	    };
	    this.resetTimedim(changeFwd);
	}.bind(this));
    },
    onAdd: function(map) {
	// now back to the normal stuff
	// this.setup_sliders(map);
	// this.contour_layer.addTo(map);
	// this.ens_trajectory_layer.addTo(map);
	// this.single_trajectory_layer.addTo(map);

	// set up the time slider (and height slider?)
	
    },
    onRemove: function() {
	// this.remove_sliders();
	// this.clearLayers();
	// this.contour_layer.remove();
	// this.ens_trajectory_layer.remove();
	// this.single_trajectory_layer.remove();
    }
});

L.layerArray.simulations = function(options) {
    return new L.LayerArray.Simulations(options);
};
